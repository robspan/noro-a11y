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

test('axe is the sole engine and unknown engines are rejected', () => {
  const { resolveEngines } = packageApi;
  assert.deepEqual(resolveEngines(['axe', 'axe']), ['axe']);
  assert.throws(() => resolveEngines(['http']), /Unbekannte Prüfengine/);
  assert.throws(() => resolveEngines(['html-validate']), /Unbekannte Prüfengine/);
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
    engines: ['axe'],
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
    engines: ['axe'],
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
      depth: 5,
      loadPage: async () => ({ url: '', html: '' }),
    }),
    /depth muss eine ganze Zahl zwischen 0 und 4/,
  );

  const result = await crawlAccessibilityChecks('https://example.org', {
    depth: 0,
    maxPages: 3_000,
    engines: ['axe'],
    loadPage: async (url) => ({
      url,
      html: '<html lang="de"><title>Start</title></html>',
      http: { status: 200, headers: { 'content-type': 'text/html' } },
    }),
  });
  assert.equal(result.maxPages, 3_000);
});

test('the crawler defaults to depth one and at most ten loaded targets', async () => {
  const { crawlAccessibilityChecks } = packageApi;
  const links = Array.from({ length: 12 }, (_, index) => `<a href="/${index + 1}">Page</a>`).join('');
  const result = await crawlAccessibilityChecks('https://example.org', {
    engines: ['axe'],
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
    engines: ['axe'],
    onProgress: (event) => events.push(event),
    loadPage: async (url) => ({
      url,
      html: '<html><title></title></html>',
      http: { status: 200, headers: { 'content-type': 'text/html' } },
    }),
  });

  assert.deepEqual(events.map(({ phase }) => phase).slice(0, 3), ['loading', 'loaded', 'checking']);
  assert.equal(events.at(-1).phase, 'crawl-completed');
});

test('axe findings are German and retain stable rule IDs across report formats', async () => {
  const { renderAgentReport, renderHtmlReport, renderMarkdownReport, renderPdfReport, renderSarifReport, runAccessibilityChecks, SPANIER_ONE_REPORT_URL, summarizeAutomatedRisk } = packageApi;
  const result = accessibilityResult([
    axeFinding('violation-image-alt', 'critical', 'Ein Bild benötigt einen Alternativtext.'),
    axeFinding('manual-review-color-contrast', 'warning', 'Farbkontrast manuell prüfen.'),
  ]);

  assert.ok(result.findings.every((finding) => finding.engine === 'axe'));
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

test('axe metadata is derived from every returned runtime bucket', async () => {
  const result = (id) => ({
    id,
    impact: 'moderate',
    tags: ['attacker-controlled-tag-is-ignored'],
    description: `Beschreibung ${id}`,
    help: `Hilfe ${id}`,
    helpUrl: `javascript:alert('${id}')`,
    nodes: [],
  });
  let executedOptions;
  const page = {
    evaluate: async (_callback, argument) => {
      if (!argument?.options) return 'attested';
      executedOptions = argument.options;
      const selected = [
        'area-alt',
        'audio-caption',
        'color-contrast',
        'image-alt',
        'label',
        'link-name',
      ];
      return {
        testEngine: { name: 'axe-core', version: argument.expectedVersion },
        testRunner: { name: 'fixture' },
        testEnvironment: {},
        timestamp: '2026-07-27T00:00:00.000Z',
        url: 'https://example.org',
        toolOptions: {},
        passes: [result(selected[0])],
        incomplete: [
          { ...result(selected[1]), nodes: [{ target: ['video'] }] },
          { ...result(selected[2]), nodes: [{ target: ['main'] }] },
        ],
        violations: [
          { ...result(selected[2]), nodes: [{ target: ['summary'] }] },
          { ...result(selected[3]), nodes: [{ target: ['img'] }] },
          { ...result(selected[4]), nodes: [{ target: [['#form-host', 'button']] }] },
          { ...result(selected[5]), nodes: [{ target: ['a'] }] },
        ],
        inapplicable: argument.options.runOnly.values
          .filter((id) => !selected.includes(id))
          .map(result),
      };
    },
  };

  const run = await packageApi.runAccessibilityChecks(
    {
      url: 'https://example.org',
      html: '<html lang="de"><title>Fixture</title></html>',
      page,
    },
    { engines: ['axe'] },
  );
  const axeResult = run.results[0];

  assert.deepEqual(
    [...executedOptions.resultTypes].sort(),
    ['inapplicable', 'incomplete', 'passes', 'violations'],
  );
  assert.equal(executedOptions.runOnly.type, 'rule');
  assert.equal(executedOptions.runOnly.values.length, 70);
  assert.equal(new Set(executedOptions.runOnly.values).size, 70);
  assert.ok(executedOptions.runOnly.values.includes('area-alt'));
  assert.ok(executedOptions.runOnly.values.includes('video-caption'));
  assert.equal(axeResult.metadata.axeVersion, '4.12.1');
  assert.equal(axeResult.metadata.rulesConfigured, 70);
  assert.equal(axeResult.metadata.ruleEvaluations, 71);
  assert.equal(axeResult.metadata.rulesWithoutFindings, 1);
  assert.equal(axeResult.metadata.rulesNeedingManualReview, 2);
  assert.equal(axeResult.metadata.rulesWithViolations, 4);
  assert.equal(axeResult.metadata.rulesWithoutRelevantContent, 64);
  const outcomes = new Map(
    axeResult.criterionResults.map(({ source, outcome }) => [source, outcome]),
  );
  assert.deepEqual([...outcomes.entries()], [
    ['axe.area-alt', 'passed'],
    ['axe.audio-caption', 'needs-review'],
    ['axe.color-contrast', 'failed'],
    ['axe.image-alt', 'failed'],
    ['axe.label', 'failed'],
    ['axe.link-name', 'failed'],
  ]);
  assert.equal(
    axeResult.criterionResults.some(({ source }) => source === 'axe.video-caption'),
    false,
  );
  assert.ok(axeResult.findings.every(({ helpUrl }) =>
    helpUrl?.startsWith('https://dequeuniversity.com/rules/axe/4.12/'),
  ));
  assert.equal(axeResult.findings.some(({ helpUrl }) => helpUrl?.startsWith('javascript:')), false);
  assert.deepEqual(
    axeResult.findings.find(({ ruleId }) => ruleId === 'violation-label')?.selectors,
    ['#form-host > button'],
  );
});

test('axe runs in Playwright as the sole automated accessibility engine', async () => {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const html = '<!doctype html><html><head><title></title></head><body><main><img src="x"><input></main></body></html>';
    await page.setContent(html);
    const result = await packageApi.runAccessibilityChecks(
      {
        url: 'https://example.org',
        html,
        http: { status: 200, headers: { 'content-type': 'text/html' } },
        page,
      },
      { engines: 'all' },
    );

    assert.deepEqual(result.requestedEngines, ['axe']);
    const axeResult = result.results.find(({ engine }) => engine === 'axe');
    assert.equal(axeResult?.status, 'completed');
    assert.equal(
      axeResult.criterionResults.some(
        ({ source }) => source === 'axe.video-caption',
      ),
      false,
      'a rule without matching content is not recorded as a passed criterion',
    );
    assert.equal(axeResult.metadata.axeVersion, '4.12.1');
    assert.equal(axeResult.metadata.rulesConfigured, 70);
    assert.equal(
      axeResult.metadata.rulesConfigured,
      axeResult.metadata.ruleEvaluations,
    );
    assert.equal(
      axeResult.metadata.ruleEvaluations,
      axeResult.metadata.rulesWithoutFindings +
        axeResult.metadata.rulesNeedingManualReview +
        axeResult.metadata.rulesWithViolations +
        axeResult.metadata.rulesWithoutRelevantContent,
    );
    const imageAlt = result.findings.find(({ sources }) =>
      sources.some(({ code }) => code === 'axe.violation-image-alt'),
    );
    assert.ok(imageAlt);
    assert.deepEqual(imageAlt.sources.map(({ engine }) => engine), ['axe']);
    assert.equal(
      result.findings.some(({ code }) => code.startsWith('http.') || code.startsWith('html-validate.')),
      false,
    );
    assert.equal(
      result.deduplication.collapsed,
      result.deduplication.rawFindings - result.deduplication.findings,
    );
    const bundle = JSON.parse(packageApi.renderJsonReport(result));
    assert.equal(bundle.deduplication.collapsed, result.deduplication.collapsed);
    assert.ok(
      bundle.findings.some(({ sources }) =>
        sources.some(({ engine }) => engine === 'axe'),
      ),
    );
    await context.close();
  } finally {
    await browser.close();
  }
});

test('a hostile page-provided window.axe runtime cannot forge findings or help links', async () => {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const html = '<!doctype html><html lang="de"><head><title>Fixture</title></head><body><main><img src="x"></main></body></html>';
    await page.setContent(html);
    await page.evaluate(() => {
      const nativeEval = window.eval;
      window.__capturedEvalSources = [];
      window.eval = (...args) => {
        window.__capturedEvalSources.push(String(args[0] ?? ''));
        return nativeEval(...args);
      };
      window.axe = {
        version: '4.12.1',
        runPartial() {},
        async run() {
          const forged = {
            id: 'image-alt',
            impact: 'minor',
            tags: ['wcag111'],
            description: 'Forged description',
            help: 'Forged help',
            helpUrl: 'javascript:alert(document.domain)',
            nodes: [{ target: [['img']] }],
          };
          return {
            testEngine: { name: 'axe-core', version: '4.12.1' },
            testRunner: { name: 'forged' },
            testEnvironment: {},
            timestamp: new Date().toISOString(),
            url: document.URL,
            toolOptions: {},
            passes: [],
            incomplete: [],
            violations: [forged],
            inapplicable: [],
          };
        },
      };
    });

    const result = await packageApi.runAccessibilityChecks(
      {
        url: 'https://example.org',
        html,
        http: { status: 200, headers: { 'content-type': 'text/html' } },
        page,
      },
      { engines: ['axe'] },
    );
    const imageAlt = result.findings.find(({ code }) =>
      code === 'axe.violation-image-alt');

    assert.ok(imageAlt);
    assert.match(imageAlt.helpUrl, /^https:\/\/dequeuniversity\.com\/rules\/axe\/4\.12\/image-alt/);
    assert.equal(result.findings.some(({ helpUrl }) => helpUrl?.startsWith('javascript:')), false);
    assert.equal(result.results[0].metadata.rulesConfigured, 70);
    const capturedEvalSources = await page.evaluate(() => [
      ...window.__capturedEvalSources,
    ]);
    assert.equal(
      capturedEvalSources.some((source) =>
        source.includes('axe.configure') || source.includes('__spanier_one_axe_')),
      false,
    );
    await page.close();
  } finally {
    await browser.close();
  }
});

test('a non-configurable hostile window.axe runtime fails closed', async () => {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html lang="de"><title>Fixture</title><main></main></html>');
    await page.evaluate(() => {
      Object.defineProperty(window, 'axe', {
        value: {
          version: '4.12.1',
          async run() {
            throw new Error('must not run');
          },
        },
        configurable: false,
        writable: false,
      });
    });

    await assert.rejects(
      packageApi.runAccessibilityChecks(
        {
          url: 'https://example.org',
          html: '<html lang="de"><title>Fixture</title><main></main></html>',
          page,
        },
        { engines: ['axe'] },
      ),
      /non-replaceable, untrusted axe runtime/,
    );
    await page.close();
  } finally {
    await browser.close();
  }
});

test('raw HTTP and HTML input never creates accessibility findings without axe', async () => {
  const { runAccessibilityChecks } = packageApi;
  const result = await runAccessibilityChecks(
    {
      url: 'https://example.org',
      html: '<html><head><title></title></head><body><h2>Ohne H1</h2><img src="missing-alt"></body></html>',
      http: { status: 500, headers: { 'content-type': 'text/plain' } },
    },
    { engines: 'all' },
  );

  assert.deepEqual(result.requestedEngines, ['axe']);
  assert.equal(result.results[0].status, 'not_run');
  assert.deepEqual(result.findings, []);
});

test('the automated risk index is deterministic and never claims conformance', () => {
  const { summarizeAutomatedRisk } = packageApi;
  const result = {
    url: 'https://example.org',
    locale: 'de',
    requestedEngines: ['axe'],
    startedAt: '2026-07-20T08:00:00.000Z',
    completedAt: '2026-07-20T08:00:01.000Z',
    results: [
      { engine: 'axe', status: 'failed', summary: '', findings: [] },
    ],
    findings: [
      {
        code: 'axe.a',
        engine: 'axe',
        ruleId: 'a',
        severity: 'critical',
        message: 'A',
        translationStatus: 'verified',
      },
      {
        code: 'axe.b',
        engine: 'axe',
        ruleId: 'b',
        severity: 'warning',
        message: 'B',
        translationStatus: 'verified',
      },
      {
        code: 'axe.c',
        engine: 'axe',
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
  const { chromium } = await import('playwright');
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  const severities = [[], ['info'], ['critical', 'critical'], ['critical', 'critical', 'critical'], ['critical', 'critical', 'critical', 'critical']];
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addInitScript(await packageApi.axeRuntimeSource());
    for (const [scenario, findings] of severities.entries()) {
      const page = await context.newPage();
      const result = accessibilityResult(
        findings.map((severity, index) => ({
          code: `axe.test-${scenario}-${index}`,
          engine: 'axe',
          ruleId: `test-${scenario}-${index}`,
          severity,
          message: `Beispielbefund ${index + 1}.`,
          translationStatus: 'verified',
          wcagCriteria: ['1.1.1'],
          selectors: ['main > img'],
        })),
      );
      await page.setContent(packageApi.renderHtmlReport(result));
      const scan = await page.evaluate(
        async (values) =>
          window.axe.run(document, {
            runOnly: { type: 'tag', values },
            resultTypes: ['violations'],
            iframes: false,
          }),
        tags,
      );
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
    requestedEngines: ['axe'],
    startedAt: '2026-07-20T08:00:00.000Z',
    completedAt: '2026-07-20T08:00:01.000Z',
    results: [
      {
        engine: 'axe',
        status: 'completed',
        summary: 'axe-core abgeschlossen.',
        findings,
        limitations: ['Eine manuelle Prüfung bleibt erforderlich.'],
      },
    ],
    findings,
  };
}

function axeFinding(ruleId, severity, message) {
  const code = `axe.${ruleId}`;
  return {
    code,
    engine: 'axe',
    ruleId,
    severity,
    message,
    translationStatus: 'verified',
    wcagCriteria: ['1.1.1'],
    selectors: ['main > img'],
    occurrenceCount: 1,
    sources: [{ engine: 'axe', ruleId, code, occurrenceCount: 1 }],
  };
}
