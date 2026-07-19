const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ENGINE_IDS,
  renderAgentReport,
  renderHtmlReport,
  renderMarkdownReport,
  renderPdfReport,
  renderSarifReport,
  resolveEngines,
  runAccessibilityChecks,
} = require('../dist');

test('all selects every available engine', () => {
  assert.deepEqual(resolveEngines('all'), [...ENGINE_IDS]);
});

test('a subset is deduplicated and unknown engines are rejected', () => {
  assert.deepEqual(resolveEngines(['http', 'http', 'html-validate']), ['http', 'html-validate']);
  assert.throws(() => resolveEngines(['unknown']), /Unbekannte Prüfengine/);
});

test('HTTP and HTML findings are German and retain stable rule IDs', async () => {
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
  assert.match(renderMarkdownReport(result), /Barrierefreiheitsbericht/);
  assert.match(renderHtmlReport(result), /<!doctype html>/);

  const pdf = await renderPdfReport(result, { preparedFor: 'Beispiel GmbH' });
  assert.equal(Buffer.from(pdf).subarray(0, 4).toString(), '%PDF');
});
