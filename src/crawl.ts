import { runAccessibilityChecks, resolveEngines } from './run.ts';
import type {
  AccessibilityCrawlOptions,
  AccessibilityCrawlPageResult,
  AccessibilityCrawlResult,
  AccessibilityRunInput,
} from './types.ts';

const DEFAULT_MAX_PAGES = 10;
const MAX_DEPTH = 10;
const MAX_PAGE_LIMIT = 1_000;

interface QueueItem {
  url: string;
  depth: number;
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
  const maxPages = boundedInteger('maxPages', options.maxPages ?? DEFAULT_MAX_PAGES, 1, MAX_PAGE_LIMIT);
  const requestedEngines = resolveEngines(options.engines ?? 'all');
  const canonicalStartUrl = canonicalizeHttpUrl(startUrl);
  if (!canonicalStartUrl) throw new Error('Die Startadresse muss eine absolute HTTP- oder HTTPS-URL sein.');

  const startedAt = new Date().toISOString();
  const queue: QueueItem[] = [{ url: canonicalStartUrl, depth: 0 }];
  const scheduled = new Set([canonicalStartUrl]);
  const auditedFinalUrls = new Set<string>();
  const pages: AccessibilityCrawlPageResult[] = [];
  let allowedHostname: string | undefined;

  while (queue.length > 0 && pages.length < maxPages) {
    const current = queue.shift() as QueueItem;
    const pageNumber = pages.length + 1;
    await progress(options, {
      phase: 'loading', url: current.url, depth: current.depth, pageNumber, maxPages,
      message: `Lade Seite ${pageNumber}: ${displayUrl(current.url)}`,
    });
    let input: AccessibilityRunInput;
    try {
      input = await options.loadPage(current.url, current.depth);
    } catch (error) {
      await progress(options, {
        phase: 'failed', url: current.url, depth: current.depth, pageNumber, maxPages,
        message: `Seite konnte nicht geladen werden: ${displayUrl(current.url)}`,
      });
      pages.push({
        requestedUrl: current.url,
        url: current.url,
        depth: current.depth,
        status: 'failed',
        error: errorMessage(error),
      });
      continue;
    }

    const finalUrl = canonicalizeHttpUrl(input.url);
    if (!finalUrl) {
      await progress(options, {
        phase: 'skipped', url: current.url, depth: current.depth, pageNumber, maxPages,
        message: 'Geladenes Ziel ohne gültige Webadresse übersprungen.',
      });
      pages.push(skippedPage(current, current.url, 'Das geladene Ziel besitzt keine gültige HTTP- oder HTTPS-URL.'));
      continue;
    }

    await progress(options, {
      phase: 'loaded', url: finalUrl, depth: current.depth, pageNumber, maxPages,
      message: `Seite ${pageNumber} geladen: ${displayUrl(finalUrl)}`,
    });

    const finalHostname = new URL(finalUrl).hostname.toLowerCase();
    allowedHostname ??= finalHostname;
    if (finalHostname !== allowedHostname) {
      await progress(options, {
        phase: 'skipped', url: finalUrl, depth: current.depth, pageNumber, maxPages,
        message: `Fremden Host übersprungen: ${displayUrl(finalUrl)}`,
      });
      pages.push(skippedPage(current, finalUrl, 'Das Ziel wurde auf einen anderen Host umgeleitet.'));
      continue;
    }
    if (auditedFinalUrls.has(finalUrl)) {
      pages.push(skippedPage(current, finalUrl, 'Das umgeleitete Ziel wurde bereits geprüft.'));
      continue;
    }
    if (!isHtmlDocument(input)) {
      pages.push(skippedPage(current, finalUrl, 'Das verlinkte Ziel ist kein HTML-Dokument.'));
      continue;
    }

    auditedFinalUrls.add(finalUrl);
    await progress(options, {
      phase: 'checking', url: finalUrl, depth: current.depth, pageNumber, maxPages,
      message: `Prüfe Seite ${pageNumber}: ${displayUrl(finalUrl)}`,
    });
    let result;
    try {
      result = await runAccessibilityChecks(
        { ...input, url: finalUrl },
        { engines: requestedEngines },
      );
    } catch (error) {
      await progress(options, {
        phase: 'failed', url: finalUrl, depth: current.depth, pageNumber, maxPages,
        message: `Prüfung fehlgeschlagen: ${displayUrl(finalUrl)}`,
      });
      pages.push({
        requestedUrl: current.url,
        url: finalUrl,
        depth: current.depth,
        status: 'failed',
        error: errorMessage(error),
      });
      continue;
    }

    pages.push({
      requestedUrl: current.url,
      url: finalUrl,
      depth: current.depth,
      status: 'completed',
      result,
    });

    for (const finding of result.findings) {
      await progress(options, {
        phase: 'finding', url: finalUrl, depth: current.depth, pageNumber, maxPages,
        message: finding.message, finding,
      });
    }
    await progress(options, {
      phase: 'completed', url: finalUrl, depth: current.depth, pageNumber, maxPages,
      message: `Seite ${pageNumber} geprüft: ${result.findings.length} Warnsignale.`,
      findingCount: result.findings.length,
    });

    if (current.depth >= depth) continue;
    for (const url of linkedPageUrls(input.html, finalUrl, allowedHostname)) {
      if (scheduled.has(url) || auditedFinalUrls.has(url)) continue;
      scheduled.add(url);
      queue.push({ url, depth: current.depth + 1 });
    }
  }


  await progress(options, {
    phase: 'crawl-completed', url: canonicalStartUrl, depth, pageNumber: pages.length, maxPages,
    message: `${pages.length} Seiten verarbeitet.`,
    findingCount: pages.reduce((sum, page) => sum + (page.result?.findings.length ?? 0), 0),
  });

  return {
    url: canonicalStartUrl,
    locale: 'de',
    requestedEngines,
    depth,
    maxPages,
    startedAt,
    completedAt: new Date().toISOString(),
    truncated: queue.length > 0,
    pages,
    findings: pages.flatMap((page) =>
      page.result?.findings.map((finding) => ({ ...finding, url: page.url, depth: page.depth })) ?? [],
    ),
  };
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
