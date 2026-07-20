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

test('HTTP and HTML findings are German and retain stable rule IDs', async () => {
  const {
    renderAgentReport,
    renderHtmlReport,
    renderMarkdownReport,
    renderPdfReport,
    renderSarifReport,
    runAccessibilityChecks,
    SPANIER_ONE_REPORT_URL,
    summarizeAutomatedRisk,
  } = packageApi;
  const result = await runAccessibilityChecks({
    url: 'https://example.org',
    html: '<!doctype html><html><head><title></title></head><body><main><img src="x"><div id="same"></div><div id="same"></div></main></body></html>',
    http: { status: 200, headers: { 'content-type': 'text/html' } },
  }, { engines: ['http', 'html-validate'] });

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

test('the automated risk index is deterministic and never claims conformance', () => {
  const { summarizeAutomatedRisk } = packageApi;
  const result = {
    url: 'https://example.org', locale: 'de', requestedEngines: ['http', 'axe'],
    startedAt: '2026-07-20T08:00:00.000Z', completedAt: '2026-07-20T08:00:01.000Z',
    results: [
      { engine: 'http', status: 'completed', summary: '', findings: [] },
      { engine: 'axe', status: 'failed', summary: '', findings: [] },
    ],
    findings: [
      { code: 'a', engine: 'http', ruleId: 'a', severity: 'critical', message: 'A', translationStatus: 'verified' },
      { code: 'b', engine: 'http', ruleId: 'b', severity: 'warning', message: 'B', translationStatus: 'verified' },
      { code: 'c', engine: 'http', ruleId: 'c', severity: 'info', message: 'C', translationStatus: 'verified' },
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
      const result = accessibilityResult(findings.map((severity, index) => ({
        code: `http.test-${scenario}-${index}`,
        engine: 'http',
        ruleId: `test-${scenario}-${index}`,
        severity,
        message: `Beispielbefund ${index + 1}.`,
        translationStatus: 'verified',
        wcagCriteria: ['1.1.1'],
        selectors: ['main > img'],
      })));
      await page.setContent(packageApi.renderHtmlReport(result));
      const scan = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      assert.deepEqual(scan.violations.map(({ id }) => id), []);
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
    results: [{
      engine: 'http',
      status: 'completed',
      summary: 'Eine HTTP-Antwort geprüft.',
      findings,
      limitations: ['Eine manuelle Prüfung bleibt erforderlich.'],
    }],
    findings,
  };
}
