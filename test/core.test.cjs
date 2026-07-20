const assert = require('node:assert/strict');
const test = require('node:test');
let packageApi;

test.before(async () => {
  packageApi = await import('../dist/index.js');
});

test('all selects every available engine', () => {
  const { ENGINE_IDS, resolveEngines } = packageApi;
  assert.deepEqual(resolveEngines('all'), [...ENGINE_IDS]);
});

test('a subset is deduplicated and unknown engines are rejected', () => {
  const { resolveEngines } = packageApi;
  assert.deepEqual(resolveEngines(['http', 'http', 'html-validate']), ['http', 'html-validate']);
  assert.throws(() => resolveEngines(['unknown']), /Unbekannte Prüfengine/);
});

test('the crawler follows same-host links breadth-first up to the requested depth', async () => {
  const { crawlAccessibilityChecks } = packageApi;
  const documents = new Map([
    ['https://example.org/', '<html lang="de"><title>Start</title><a href="/one#content">One</a><a href="https://outside.test/">Outside</a></html>'],
    ['https://example.org/one', '<html lang="de"><title>One</title><a href="/two">Two</a><a href="/">Start</a></html>'],
    ['https://example.org/two', '<html lang="de"><title>Two</title></html>'],
  ]);
  const loaded = [];
  const result = await crawlAccessibilityChecks('https://example.org', {
    depth: 1,
    maxPages: 10,
    engines: ['http'],
    loadPage: async (url) => {
      loaded.push(url);
      const html = documents.get(url);
      if (!html) throw new Error(`Unexpected URL: ${url}`);
      return {
        url,
        html,
        http: { status: 200, headers: { 'content-type': 'text/html' } },
      };
    },
  });

  assert.deepEqual(loaded, ['https://example.org/', 'https://example.org/one']);
  assert.equal(result.pages.filter(({ status }) => status === 'completed').length, 2);
  assert.equal(
    result.pages.some(({ url }) => url === 'https://example.org/two'),
    false,
  );
  assert.equal(
    result.findings.every(({ url, depth }) => url.startsWith('https://example.org/') && depth <= 1),
    true,
  );
  assert.equal(result.truncated, false);
});

test('the crawler caps page count and skips non-HTML targets and cross-host redirects', async () => {
  const { crawlAccessibilityChecks } = packageApi;
  const result = await crawlAccessibilityChecks('https://example.org', {
    depth: 2,
    maxPages: 3,
    engines: ['http'],
    loadPage: async (url) => {
      if (url === 'https://example.org/') {
        return {
          url,
          html: '<html lang="de"><title>Start</title><a href="/document.pdf" download>PDF</a><a href="/one">One</a><a href="/two">Two</a><a href="/three">Three</a></html>',
          http: { status: 200, headers: { 'content-type': 'text/html' } },
        };
      }
      if (url.endsWith('/one')) {
        return {
          url,
          html: '%PDF',
          http: { status: 200, headers: { 'Content-Type': 'application/pdf' } },
        };
      }
      return {
        url: 'https://outside.test/redirected',
        html: '<html lang="de"><title>Outside</title></html>',
        http: { status: 200, headers: { 'content-type': 'text/html' } },
      };
    },
  });

  assert.deepEqual(
    result.pages.map(({ status }) => status),
    ['completed', 'skipped', 'skipped'],
  );
  assert.equal(result.truncated, true);
  assert.equal(
    result.pages.some(({ requestedUrl }) => requestedUrl.endsWith('document.pdf')),
    false,
  );
});

test('crawler options reject unsafe bounds', async () => {
  const { crawlAccessibilityChecks } = packageApi;
  await assert.rejects(
    crawlAccessibilityChecks('https://example.org', {
      depth: 11,
      loadPage: async () => ({ url: '', html: '' }),
    }),
    /depth muss eine ganze Zahl zwischen 0 und 10/,
  );
});

test('the crawler defaults to depth one and at most ten loaded targets', async () => {
  const { crawlAccessibilityChecks } = packageApi;
  const links = Array.from({ length: 12 }, (_, index) => `<a href="/${index + 1}">Page</a>`).join('');
  const result = await crawlAccessibilityChecks('https://example.org', {
    engines: ['http'],
    loadPage: async (url) => ({
      url,
      html: url === 'https://example.org/' ? `<html lang="de"><title>Start</title>${links}</html>` : '<html lang="de"><title>Child</title></html>',
      http: { status: 200, headers: { 'content-type': 'text/html' } },
    }),
  });

  assert.equal(result.depth, 1);
  assert.equal(result.maxPages, 10);
  assert.equal(result.pages.length, 10);
  assert.equal(result.truncated, true);
});

test('the crawler emits page and finding progress for streaming consumers', async () => {
  const { crawlAccessibilityChecks } = packageApi;
  const events = [];
  await crawlAccessibilityChecks('https://example.org', {
    depth: 0,
    engines: ['http'],
    onProgress: (event) => events.push(event),
    loadPage: async (url) => ({
      url,
      html: '<html><title></title></html>',
      http: { status: 200, headers: { 'content-type': 'text/html' } },
    }),
  });

  assert.deepEqual(events.map(({ phase }) => phase).slice(0, 3), ['loading', 'loaded', 'checking']);
  assert.ok(events.some(({ phase, finding }) => phase === 'finding' && finding));
  assert.equal(events.at(-1).phase, 'crawl-completed');
});

test('HTTP and HTML findings are German and retain stable rule IDs', async () => {
  const { renderAgentReport, renderHtmlReport, renderMarkdownReport, renderPdfReport, renderSarifReport, runAccessibilityChecks, SPANIER_ONE_REPORT_URL, summarizeAutomatedRisk } = packageApi;
  const result = await runAccessibilityChecks(
    {
      url: 'https://example.org',
      html: '<!doctype html><html><head><title></title></head><body><main><img src="x"><div id="same"></div><div id="same"></div></main></body></html>',
      http: { status: 200, headers: { 'content-type': 'text/html' } },
    },
    { engines: ['http', 'html-validate'] },
  );

  assert.ok(result.findings.some((finding) => finding.ruleId === 'html-missing-lang'));
  assert.ok(result.findings.some((finding) => finding.ruleId === 'no-dup-id'));
  assert.ok(result.findings.every((finding) => finding.message.length > 0));
  assert.ok(result.findings.every((finding) => !finding.message.includes('must')));
  assert.equal(result.url, 'https://example.org');

  const agent = renderAgentReport(result);
  assert.equal(agent.language, 'de');
  assert.ok(agent.tasks[0].acceptanceCriteria.length >= 2);

  const sarif = renderSarifReport(result);
  assert.equal(sarif.version, '2.1.0');
  const summary = summarizeAutomatedRisk(result);
  assert.ok(summary.index > 0 && summary.index <= 100);
  assert.equal(summary.counts.critical > 0, true);

  const markdown = renderMarkdownReport(result);
  assert.match(markdown, /automatische[rn]? Befundindex/i);
  assert.match(markdown, new RegExp(SPANIER_ONE_REPORT_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const htmlReport = renderHtmlReport(result);
  assert.match(htmlReport, /<!doctype html>/);
  assert.match(htmlReport, /Schnelle Einordnung/);
  assert.match(htmlReport, /Vollständiger technischer Befund/);
  assert.match(htmlReport, /misst weder WCAG-Abdeckung noch rechtliche Konformität/i);
  assert.match(htmlReport, new RegExp(SPANIER_ONE_REPORT_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const pdf = await renderPdfReport(result, { preparedFor: 'Beispiel GmbH' });
  const pdfBuffer = Buffer.from(pdf);
  const pdfStructure = pdfBuffer.toString('latin1');
  assert.equal(pdfBuffer.subarray(0, 4).toString(), '%PDF');
  assert.match(pdfStructure, /\/StructTreeRoot/);
  assert.match(pdfStructure, /\/Marked true/);
  assert.match(pdfStructure, /\/Lang \(de\)/);
  assert.match(pdfStructure, /\/URI \(https:\/\/spanier\.one\//);
});

test('HTTP image-alt accepts every valid HTML attribute syntax', async () => {
  const { runAccessibilityChecks } = packageApi;
  for (const image of ['<img src="decorative.svg" alt>', '<img src="decorative.svg" alt="">', '<img src="logo.svg" alt="Beispiel GmbH">', '<img src="logo.svg" alt=Beispiel>']) {
    const result = await runAccessibilityChecks(
      {
        url: 'https://example.org',
        html: `<!doctype html><html lang="de"><head><title>Test</title></head><body>${image}</body></html>`,
        http: { status: 200, headers: { 'content-type': 'text/html' } },
      },
      { engines: ['http'] },
    );

    assert.equal(
      result.findings.some(({ ruleId }) => ruleId === 'html-images-without-alt'),
      false,
      image,
    );
  }

  const missing = await runAccessibilityChecks(
    {
      url: 'https://example.org',
      html: '<!doctype html><html lang="de"><head><title>Test</title></head><body><img src="missing.svg"></body></html>',
      http: { status: 200, headers: { 'content-type': 'text/html' } },
    },
    { engines: ['http'] },
  );
  assert.equal(
    missing.findings.some(({ ruleId }) => ruleId === 'html-images-without-alt'),
    true,
  );
});

test('the automated risk index is deterministic and never claims conformance', () => {
  const { summarizeAutomatedRisk } = packageApi;
  const result = {
    url: 'https://example.org',
    locale: 'de',
    requestedEngines: ['http', 'axe'],
    startedAt: '2026-07-20T08:00:00.000Z',
    completedAt: '2026-07-20T08:00:01.000Z',
    results: [
      { engine: 'http', status: 'completed', summary: '', findings: [] },
      { engine: 'axe', status: 'failed', summary: '', findings: [] },
    ],
    findings: [
      {
        code: 'a',
        engine: 'http',
        ruleId: 'a',
        severity: 'critical',
        message: 'A',
        translationStatus: 'verified',
      },
      {
        code: 'b',
        engine: 'http',
        ruleId: 'b',
        severity: 'warning',
        message: 'B',
        translationStatus: 'verified',
      },
      {
        code: 'c',
        engine: 'http',
        ruleId: 'c',
        severity: 'info',
        message: 'C',
        translationStatus: 'verified',
      },
    ],
  };
  const summary = summarizeAutomatedRisk(result);
  assert.equal(summary.index, 45);
  assert.equal(summary.band, 'elevated');
  assert.match(summary.statement, /strukturierte Prüfung/);
});

test('the branded HTML report has no automated WCAG A or AA violations in any risk band', async () => {
  const { AxeBuilder } = await import('@axe-core/playwright');
  const { chromium } = await import('playwright');
  const severities = [[], ['info'], ['critical', 'critical'], ['critical', 'critical', 'critical'], ['critical', 'critical', 'critical', 'critical']];
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    for (const [scenario, findings] of severities.entries()) {
      const page = await context.newPage();
      const result = accessibilityResult(
        findings.map((severity, index) => ({
          code: `http.test-${scenario}-${index}`,
          engine: 'http',
          ruleId: `test-${scenario}-${index}`,
          severity,
          message: `Beispielbefund ${index + 1}.`,
          translationStatus: 'verified',
          wcagCriteria: ['1.1.1'],
          selectors: ['main > img'],
        })),
      );
      await page.setContent(packageApi.renderHtmlReport(result));
      const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(
        scan.violations.map(({ id }) => id),
        [],
      );
      await page.close();
    }
    await context.close();
  } finally {
    await browser.close();
  }
});

function accessibilityResult(findings) {
  return {
    url: 'https://example.org',
    locale: 'de',
    requestedEngines: ['http'],
    startedAt: '2026-07-20T08:00:00.000Z',
    completedAt: '2026-07-20T08:00:01.000Z',
    results: [
      {
        engine: 'http',
        status: 'completed',
        summary: 'Eine HTTP-Antwort geprüft.',
        findings,
        limitations: ['Eine manuelle Prüfung bleibt erforderlich.'],
      },
    ],
    findings,
  };
}
