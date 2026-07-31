import { runAccessibilityChecks, resolveEngines } from './run.ts';
import type {
  AccessibilityCrawlOptions,
  AccessibilityCrawlPageResult,
  AccessibilityCrawlResult,
  AccessibilityRunInput,
  AccessibilityRunResult,
  EngineId,
} from './types.ts';

const DEFAULT_MAX_PAGES = 10;
const MAX_DEPTH = 4;

interface QueueItem {
  url: string;
  depth: number;
}

interface CrawlState {
  queue: QueueItem[];
  scheduled: Set<string>;
  auditedFinalUrls: Set<string>;
  pages: AccessibilityCrawlPageResult[];
  allowedHostname?: string;
}

interface CrawlExecution {
  options: AccessibilityCrawlOptions;
  requestedEngines: EngineId[];
  depth: number;
  maxPages: number;
  state: CrawlState;
}

interface LoadedPageContext {
  execution: CrawlExecution;
  current: QueueItem;
  input: AccessibilityRunInput;
  finalUrl: string;
  pageNumber: number;
}

/**
 * Prüft eine Startseite und – begrenzt durch `depth` – intern verlinkte HTML-Seiten.
 * Das Laden bleibt absichtlich beim Aufrufer, damit Authentifizierung, SSRF-Schutz
 * und Browser-Lebenszyklen zur jeweiligen Anwendung passen.
 */
export async function crawlAccessibilityChecks(
  startUrl: string,
  options: AccessibilityCrawlOptions,
): Promise<AccessibilityCrawlResult> {
  const depth = boundedInteger('depth', options.depth ?? 1, 0, MAX_DEPTH);
  const maxPages = boundedInteger(
    'maxPages',
    options.maxPages ?? DEFAULT_MAX_PAGES,
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const requestedEngines = resolveEngines(options.engines ?? 'all');
  const canonicalStartUrl = canonicalizeHttpUrl(startUrl);
  if (!canonicalStartUrl) throw new Error('Die Startadresse muss eine absolute HTTP- oder HTTPS-URL sein.');

  const startedAt = new Date().toISOString();
  const state: CrawlState = {
    queue: [{ url: canonicalStartUrl, depth: 0 }],
    scheduled: new Set([canonicalStartUrl]),
    auditedFinalUrls: new Set<string>(),
    pages: [],
  };
  const execution: CrawlExecution = {
    options,
    requestedEngines,
    depth,
    maxPages,
    state,
  };

  while (state.queue.length > 0 && state.pages.length < maxPages) {
    const current = state.queue.shift() as QueueItem;
    await processCrawlPage(execution, current);
  }

  await progress(options, {
    phase: 'crawl-completed', url: canonicalStartUrl, depth, pageNumber: state.pages.length, maxPages,
    message: `${state.pages.length} Seiten verarbeitet.`,
    findingCount: state.pages.reduce((sum, page) => sum + (page.result?.findings.length ?? 0), 0),
  });

  return {
    url: canonicalStartUrl,
    locale: 'de',
    requestedEngines,
    depth,
    maxPages,
    startedAt,
    completedAt: new Date().toISOString(),
    truncated: state.queue.length > 0,
    pages: state.pages,
    findings: state.pages.flatMap((page) =>
      page.result?.findings.map((finding) => ({ ...finding, url: page.url, depth: page.depth })) ?? [],
    ),
  };
}

async function processCrawlPage(
  execution: CrawlExecution,
  current: QueueItem,
): Promise<void> {
  const pageNumber = execution.state.pages.length + 1;
  const input = await loadCrawlPage(execution, current, pageNumber);
  if (!input) return;
  const finalUrl = await validateLoadedPage(execution, current, input, pageNumber);
  if (!finalUrl) return;
  const context = { execution, current, input, finalUrl, pageNumber };
  const result = await auditCrawlPage(context);
  if (!result) return;
  await completeCrawlPage(context, result);
}

async function loadCrawlPage(
  execution: CrawlExecution,
  current: QueueItem,
  pageNumber: number,
): Promise<AccessibilityRunInput | undefined> {
  await progress(execution.options, {
    phase: 'loading', url: current.url, depth: current.depth, pageNumber, maxPages: execution.maxPages,
    message: `Lade Seite ${pageNumber}: ${displayUrl(current.url)}`,
  });
  try {
    return await execution.options.loadPage(current.url, current.depth);
  } catch (error) {
    await recordFailedPage({
      execution, current, url: current.url, pageNumber,
      message: `Seite konnte nicht geladen werden: ${displayUrl(current.url)}`,
      error,
    });
    return undefined;
  }
}

async function validateLoadedPage(
  execution: CrawlExecution,
  current: QueueItem,
  input: AccessibilityRunInput,
  pageNumber: number,
): Promise<string | undefined> {
  const finalUrl = canonicalizeHttpUrl(input.url);
  if (!finalUrl) {
    await recordSkippedPage({
      execution, current, url: current.url, pageNumber,
      eventMessage: 'Geladenes Ziel ohne gültige Webadresse übersprungen.',
      pageError: 'Das geladene Ziel besitzt keine gültige HTTP- oder HTTPS-URL.',
    });
    return undefined;
  }
  await progress(execution.options, {
    phase: 'loaded', url: finalUrl, depth: current.depth, pageNumber, maxPages: execution.maxPages,
    message: `Seite ${pageNumber} geladen: ${displayUrl(finalUrl)}`,
  });
  return acceptedFinalUrl({
    execution,
    current,
    input,
    finalUrl,
    pageNumber,
  });
}

async function acceptedFinalUrl(
  context: LoadedPageContext,
): Promise<string | undefined> {
  const { execution, current, input, finalUrl, pageNumber } = context;
  const finalHostname = new URL(finalUrl).hostname.toLowerCase();
  execution.state.allowedHostname ??= finalHostname;
  const rejection = loadedPageRejection(execution.state, input, finalUrl, finalHostname);
  if (!rejection) return finalUrl;
  await recordSkippedPage({
    execution,
    current,
    url: finalUrl,
    pageNumber,
    ...rejection,
  });
  return undefined;
}

function loadedPageRejection(
  state: CrawlState,
  input: AccessibilityRunInput,
  finalUrl: string,
  finalHostname: string,
): { eventMessage: string; pageError: string } | undefined {
  if (finalHostname !== state.allowedHostname) {
    return {
      eventMessage: `Fremden Host übersprungen: ${displayUrl(finalUrl)}`,
      pageError: 'Das Ziel wurde auf einen anderen Host umgeleitet.',
    };
  }
  if (state.auditedFinalUrls.has(finalUrl)) {
    return {
      eventMessage: 'Bereits geprüftes Umleitungsziel übersprungen.',
      pageError: 'Das umgeleitete Ziel wurde bereits geprüft.',
    };
  }
  if (!isHtmlDocument(input)) {
    return {
      eventMessage: 'Nicht-HTML-Ziel übersprungen.',
      pageError: 'Das verlinkte Ziel ist kein HTML-Dokument.',
    };
  }
  return undefined;
}

async function auditCrawlPage(
  context: LoadedPageContext,
): Promise<AccessibilityRunResult | undefined> {
  const { execution, current, input, finalUrl, pageNumber } = context;
  execution.state.auditedFinalUrls.add(finalUrl);
  await progress(execution.options, {
    phase: 'checking', url: finalUrl, depth: current.depth, pageNumber, maxPages: execution.maxPages,
    message: `Prüfe Seite ${pageNumber}: ${displayUrl(finalUrl)}`,
  });
  try {
    return await runAccessibilityChecks(
      { ...input, url: finalUrl },
      { engines: execution.requestedEngines },
    );
  } catch (error) {
    await recordFailedPage({
      execution, current, url: finalUrl, pageNumber,
      message: `Prüfung fehlgeschlagen: ${displayUrl(finalUrl)}`,
      error,
    });
    return undefined;
  }
}

async function completeCrawlPage(
  context: LoadedPageContext,
  result: AccessibilityRunResult,
): Promise<void> {
  const { execution, current, input, finalUrl, pageNumber } = context;
  execution.state.pages.push({
    requestedUrl: current.url,
    url: finalUrl,
    depth: current.depth,
    status: 'completed',
    result,
  });
  await emitAuditProgress(context, result);
  scheduleLinkedPages(execution, current, input, finalUrl);
}

async function emitAuditProgress(
  context: LoadedPageContext,
  result: AccessibilityRunResult,
): Promise<void> {
  const { execution, current, finalUrl, pageNumber } = context;
  for (const finding of result.findings) {
    await progress(execution.options, {
      phase: 'finding', url: finalUrl, depth: current.depth, pageNumber, maxPages: execution.maxPages,
      message: finding.message, finding,
    });
  }
  await progress(execution.options, {
    phase: 'completed', url: finalUrl, depth: current.depth, pageNumber, maxPages: execution.maxPages,
    message: `Seite ${pageNumber} geprüft: ${result.findings.length} Warnsignale.`,
    findingCount: result.findings.length,
  });
}

function scheduleLinkedPages(
  execution: CrawlExecution,
  current: QueueItem,
  input: AccessibilityRunInput,
  finalUrl: string,
): void {
  if (current.depth >= execution.depth) return;
  const urls = linkedPageUrls(input.html, finalUrl, execution.state.allowedHostname);
  for (const url of urls) {
    if (execution.state.scheduled.has(url) || execution.state.auditedFinalUrls.has(url)) continue;
    execution.state.scheduled.add(url);
    execution.state.queue.push({ url, depth: current.depth + 1 });
  }
}

async function recordSkippedPage(
  input: {
    execution: CrawlExecution;
    current: QueueItem;
    url: string;
    pageNumber: number;
    eventMessage: string;
    pageError: string;
  },
): Promise<void> {
  const { execution, current, url, pageNumber, eventMessage, pageError } = input;
  await progress(execution.options, {
    phase: 'skipped', url, depth: current.depth, pageNumber, maxPages: execution.maxPages,
    message: eventMessage,
  });
  execution.state.pages.push(skippedPage(current, url, pageError));
}

async function recordFailedPage(
  input: {
    execution: CrawlExecution;
    current: QueueItem;
    url: string;
    pageNumber: number;
    message: string;
    error: unknown;
  },
): Promise<void> {
  const { execution, current, url, pageNumber, message, error } = input;
  await progress(execution.options, {
    phase: 'failed', url, depth: current.depth, pageNumber, maxPages: execution.maxPages,
    message,
  });
  execution.state.pages.push({
    requestedUrl: current.url,
    url,
    depth: current.depth,
    status: 'failed',
    error: errorMessage(error),
  });
}

async function progress(
  options: AccessibilityCrawlOptions,
  event: Parameters<NonNullable<AccessibilityCrawlOptions['onProgress']>>[0],
): Promise<void> {
  await options.onProgress?.(event);
}

function displayUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return value;
  }
}

/** Extrahiert kanonische, zum selben Host gehörende Links aus einem HTML-Dokument. */
export function linkedPageUrls(html: string, pageUrl: string, hostname?: string): string[] {
  const canonicalPageUrl = canonicalizeHttpUrl(pageUrl);
  if (!canonicalPageUrl) return [];
  const allowedHostname = (hostname ?? new URL(canonicalPageUrl).hostname).toLowerCase();
  const baseUrl = documentBaseUrl(html, canonicalPageUrl);
  const urls = new Set<string>();
  const anchorPattern = /<a\b[^>]*>/gi;

  for (const match of html.matchAll(anchorPattern)) {
    const tag = match[0];
    if (/\sdownload(?:\s*=|\s|>)/i.test(tag)) continue;
    const href = attributeValue(tag, 'href');
    if (!href) continue;
    const url = canonicalizeHttpUrl(decodeHtmlEntities(href), baseUrl);
    if (!url || new URL(url).hostname.toLowerCase() !== allowedHostname) continue;
    urls.add(url);
  }

  return [...urls];
}

function skippedPage(current: QueueItem, url: string, error: string): AccessibilityCrawlPageResult {
  return { requestedUrl: current.url, url, depth: current.depth, status: 'skipped', error };
}

function documentBaseUrl(html: string, pageUrl: string): string {
  const baseTag = /<base\b[^>]*>/i.exec(html)?.[0];
  const href = baseTag ? attributeValue(baseTag, 'href') : undefined;
  return (href && canonicalizeHttpUrl(decodeHtmlEntities(href), pageUrl)) || pageUrl;
}

function attributeValue(tag: string, name: string): string | undefined {
  const pattern = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = pattern.exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function canonicalizeHttpUrl(value: string, base?: string): string | undefined {
  try {
    const url = new URL(value, base);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return undefined;
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

function isHtmlDocument(input: AccessibilityRunInput): boolean {
  const contentType = Object.entries(input.http?.headers ?? {})
    .find(([name]) => name.toLowerCase() === 'content-type')?.[1];
  return !contentType || /(?:text\/html|application\/xhtml\+xml)/i.test(contentType);
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|amp|quot|apos|lt|gt);/gi, (entity, decimal, hex) => {
    if (decimal) return String.fromCodePoint(Number(decimal));
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    const named: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
    return named[entity.slice(1, -1).toLowerCase()] ?? entity;
  });
}

function boundedInteger(name: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} muss eine ganze Zahl zwischen ${minimum} und ${maximum} sein.`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Das Ziel konnte nicht geprüft werden.';
}
