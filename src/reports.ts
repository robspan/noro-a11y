import type {
  AccessibilityRunResult,
  AgentReport,
  AgentTask,
  NormalizedFinding,
  ReportOptions,
} from './types.ts';

/** Serialisiert das vollständige, typisierte Prüfergebnis. */
export function renderJsonReport(result: AccessibilityRunResult): string {
  return JSON.stringify(result, null, 2);
}

/** Erzeugt SARIF 2.1.0 für CI-Systeme und Code-Scanning-Oberflächen. */
export function renderSarifReport(result: AccessibilityRunResult): Record<string, unknown> {
  const rules = [...new Map(result.findings.map((finding) => [
    `${finding.engine}/${finding.ruleId}`,
    {
      id: `${finding.engine}/${finding.ruleId}`,
      name: finding.ruleId,
      shortDescription: { text: finding.message },
      helpUri: finding.helpUrl,
      properties: { tags: finding.wcagCriteria?.map((criterion) => `wcag/${criterion}`) ?? [] },
    },
  ])).values()];

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: { driver: { name: '@spanier-one/barrierefreiheit', informationUri: 'https://jsr.io/@spanier-one/barrierefreiheit', rules } },
      automationDetails: { description: { text: `Barrierefreiheitsprüfung von ${result.url}` } },
      results: result.findings.map((finding) => ({
        ruleId: `${finding.engine}/${finding.ruleId}`,
        level: sarifLevel(finding.severity),
        message: { text: finding.message },
        locations: [{
          physicalLocation: {
            artifactLocation: { uri: result.url },
            region: finding.location,
          },
          logicalLocations: finding.selectors?.map((selector) => ({ name: selector, kind: 'element' })) ?? [],
        }],
      })),
    }],
  };
}

/** Erzeugt einen kompakten Bericht für Menschen und Ticketsysteme. */
export function renderMarkdownReport(result: AccessibilityRunResult, options: ReportOptions = {}): string {
  const title = options.title ?? 'Automatischer Barrierefreiheitsbericht';
  const lines = [
    `# ${title}`,
    '',
    `**Website:** ${result.url}`,
    `**Prüfzeitpunkt:** ${formatDate(result.completedAt)}`,
    `**Engines:** ${result.requestedEngines.join(', ')}`,
    `**Befunde:** ${result.findings.length}`,
    '',
  ];
  for (const finding of sortedFindings(result.findings)) {
    lines.push(
      `## ${severityLabel(finding.severity)} · ${finding.code}`,
      '',
      finding.message,
      '',
      `- Regel: \`${finding.engine}/${finding.ruleId}\``,
      `- WCAG: ${finding.wcagCriteria?.join(', ') || 'nicht automatisch zugeordnet'}`,
      `- Elemente: ${finding.selectors?.map((value) => `\`${value}\``).join(', ') || 'seitenweit'}`,
    );
    if (finding.helpUrl) lines.push(`- Hilfe: ${finding.helpUrl}`);
    if (options.includeOriginalMessages && finding.originalMessage) {
      lines.push(`- Originalmeldung: ${finding.originalMessage}`);
    }
    lines.push('');
  }
  lines.push('> Hinweis: Automatische Prüfungen allein weisen keine rechtliche Konformität nach.');
  return lines.join('\n');
}

/** Erzeugt einen eigenständigen, semantischen HTML-Bericht ohne externe Assets. */
export function renderHtmlReport(result: AccessibilityRunResult, options: ReportOptions = {}): string {
  const title = options.title ?? 'Automatischer Barrierefreiheitsbericht';
  const findings = sortedFindings(result.findings).map((finding) => `
    <article class="finding severity-${finding.severity}">
      <p class="eyebrow">${escapeHtml(severityLabel(finding.severity))} · ${escapeHtml(finding.code)}</p>
      <h2>${escapeHtml(finding.message)}</h2>
      <dl>
        <div><dt>Regel</dt><dd><code>${escapeHtml(`${finding.engine}/${finding.ruleId}`)}</code></dd></div>
        <div><dt>WCAG</dt><dd>${escapeHtml(finding.wcagCriteria?.join(', ') || 'Nicht automatisch zugeordnet')}</dd></div>
        <div><dt>Elemente</dt><dd>${escapeHtml(finding.selectors?.join(', ') || 'Seitenweit')}</dd></div>
      </dl>
    </article>`).join('');
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${escapeHtml(title)}</title><style>${REPORT_CSS}</style></head>
<body><header><strong>spanier.one</strong><span>Prüfbericht</span></header><main>
<p class="eyebrow">Automatische Bestandsaufnahme</p><h1>${escapeHtml(title)}</h1>
<p class="lead">${escapeHtml(result.url)}</p>
<section class="summary" aria-label="Zusammenfassung"><div><strong>${result.findings.length}</strong><span>Befunde</span></div><div><strong>${result.requestedEngines.length}</strong><span>Engines</span></div><div><strong>${criticalCount(result)}</strong><span>Kritisch</span></div></section>
${options.preparedFor ? `<p>Erstellt für: <strong>${escapeHtml(options.preparedFor)}</strong></p>` : ''}
<section aria-label="Befunde">${findings || '<p>Keine automatischen Befunde.</p>'}</section>
<aside><strong>Einordnung:</strong> Automatische Prüfungen allein weisen keine rechtliche Konformität nach.</aside>
</main><footer>@spanier-one/barrierefreiheit · ${escapeHtml(formatDate(result.completedAt))}</footer></body></html>`;
}

/** Liefert einen deterministischen, agententauglichen Maßnahmenplan als JSON-Objekt. */
export function renderAgentReport(result: AccessibilityRunResult): AgentReport {
  return {
    schemaVersion: '1.0',
    language: 'de',
    objective: `Behebe die dokumentierten Barrieren auf ${result.url}, ohne bestehende Funktionen zu verändern.`,
    source: { url: result.url, checkedAt: result.completedAt, engines: result.requestedEngines },
    constraints: [
      'Änderungen müssen semantisches HTML und native Browserfunktionen bevorzugen.',
      'Keine Overlay-Widgets als Ersatz für Quellcode-Korrekturen einsetzen.',
      'Jede Aufgabe einzeln umsetzen, testen und anschließend erneut prüfen.',
      'Automatische Erfolge nicht als vollständigen Konformitätsnachweis behandeln.',
    ],
    tasks: sortedFindings(result.findings).map(toAgentTask),
  };
}

function toAgentTask(finding: NormalizedFinding, index: number): AgentTask {
  return {
    id: `SPANIER-${String(index + 1).padStart(3, '0')}`,
    priority: finding.severity === 'critical' ? 'P0' : finding.severity === 'warning' ? 'P1' : 'P2',
    ruleId: finding.ruleId,
    engine: finding.engine,
    problem: finding.message,
    selectors: finding.selectors ?? [],
    wcagCriteria: finding.wcagCriteria ?? [],
    acceptanceCriteria: [
      `Der Befund ${finding.code} tritt bei einer erneuten Prüfung nicht mehr auf.`,
      'Die betroffene Funktion bleibt per Tastatur und assistiver Technologie bedienbar.',
      'Es entstehen keine neuen kritischen oder warnenden Befunde.',
    ],
    helpUrl: finding.helpUrl,
  };
}

function sortedFindings(findings: NormalizedFinding[]): NormalizedFinding[] {
  const order = { critical: 0, warning: 1, info: 2 } as const;
  return [...findings].sort((a, b) => order[a.severity] - order[b.severity] || a.code.localeCompare(b.code));
}

function sarifLevel(severity: NormalizedFinding['severity']): 'error' | 'warning' | 'note' {
  return severity === 'critical' ? 'error' : severity === 'warning' ? 'warning' : 'note';
}

function severityLabel(severity: NormalizedFinding['severity']): string {
  return severity === 'critical' ? 'Kritisch' : severity === 'warning' ? 'Warnung' : 'Hinweis';
}

function criticalCount(result: AccessibilityRunResult): number {
  return result.findings.filter((finding) => finding.severity === 'critical').length;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date(value));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] ?? character);
}

const REPORT_CSS = `
:root{font-family:Inter,Arial,sans-serif;color:#0b1224;background:#f4f6ff}*{box-sizing:border-box}body{margin:0}header,main,footer{max-width:1080px;margin:auto}header{display:flex;justify-content:space-between;align-items:center;padding:28px 32px}header strong{font-size:34px}main{background:#fff;border-radius:32px;padding:52px;margin-bottom:28px;box-shadow:0 24px 70px #10205018}.eyebrow{text-transform:uppercase;letter-spacing:.12em;font:700 12px/1.4 ui-monospace,monospace;color:#204feb}h1{font-size:48px;line-height:1;margin:12px 0}.lead{color:#5d6680;font-size:20px}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:36px 0}.summary div{background:#f4f6ff;border-radius:18px;padding:20px}.summary strong,.summary span{display:block}.summary strong{font-size:34px}.finding{padding:24px 0;border-top:1px solid #e1e5f0}.finding h2{font-size:22px}.severity-critical{border-left:4px solid #ef476f;padding-left:20px}.severity-warning{border-left:4px solid #ffb703;padding-left:20px}.severity-info{border-left:4px solid #2454eb;padding-left:20px}dl div{display:grid;grid-template-columns:100px 1fr;gap:12px;margin:8px 0}dt{font-weight:700}dd{margin:0}aside{background:#0b1224;color:#fff;padding:24px;border-radius:18px;margin-top:30px}footer{padding:12px 32px 42px;color:#5d6680}@media(max-width:680px){main{margin:0;border-radius:0;padding:28px 20px}h1{font-size:36px}.summary{grid-template-columns:1fr}dl div{grid-template-columns:1fr;gap:2px}}`;
