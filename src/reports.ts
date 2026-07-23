import type {
  AccessibilityRunResult,
  AgentReport,
  AgentTask,
  FindingSource,
  NormalizedFinding,
  ReportOptions,
} from './types.ts';
import { SPANIER_ONE_REPORT_URL, summarizeAutomatedRisk } from './report-summary.ts';

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
      properties: {
        tags: finding.wcagCriteria?.map((criterion) => `wcag/${criterion}`) ?? [],
        sources: findingSources(finding).map(({ engine, ruleId }) => `${engine}/${ruleId}`),
      },
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
  const summary = summarizeAutomatedRisk(result);
  const lines = [
    `# ${title}`,
    '',
    `## ${summary.label}: ${summary.index}/100`,
    '',
    summary.statement,
    '',
    `- Kritische Befunde: ${summary.counts.critical}`,
    `- Warnungen: ${summary.counts.warning}`,
    `- Hinweise: ${summary.counts.info}`,
    `- Prüfengines abgeschlossen: ${summary.engines.completed}/${summary.engines.requested}`,
    '',
    '> Der automatische Befundindex verdichtet Anzahl und Schwere der Tool-Befunde. Er ist kein Accessibility- oder Konformitätsscore.',
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
      `- Quellen: ${findingSources(finding).map((source) => `\`${source.engine}/${source.ruleId}\``).join(', ')}`,
      `- WCAG: ${finding.wcagCriteria?.join(', ') || 'nicht automatisch zugeordnet'}`,
      `- Elemente: ${finding.selectors?.map((value) => `\`${value}\``).join(', ') || 'seitenweit'}`,
    );
    if (finding.helpUrl) lines.push(`- Hilfe: ${finding.helpUrl}`);
    if (options.includeOriginalMessages && finding.originalMessage) {
      lines.push(`- Originalmeldung: ${finding.originalMessage}`);
    }
    lines.push('');
  }
  lines.push(
    '> Hinweis: Automatische Prüfungen allein weisen keine rechtliche Konformität nach.',
    '',
    `[Erstellt mit @spanier-one/barrierefreiheit · Ergebnis fachlich einordnen](${SPANIER_ONE_REPORT_URL})`,
  );
  return lines.join('\n');
}

/** Erzeugt einen eigenständigen, semantischen HTML-Bericht ohne externe Assets. */
export function renderHtmlReport(result: AccessibilityRunResult, options: ReportOptions = {}): string {
  const title = options.title ?? 'Automatischer Barrierefreiheitsbericht';
  const summary = summarizeAutomatedRisk(result);
  const findings = sortedFindings(result.findings).map((finding, index) => renderFindingHtml(
    finding,
    index,
    options.includeOriginalMessages ?? false,
  )).join('');
  const engines = result.results.map((engine) => `
    <article class="engine-card">
      <div><span class="engine-status status-${escapeHtml(engine.status)}">${escapeHtml(checkStatusLabel(engine.status))}</span><h3>${bookmarkHeadingHtml(engine.engine)}</h3></div>
      <p>${escapeHtml(engine.summary)}</p>
      ${engine.limitations?.length ? `<details><summary>Grenzen dieser Engine</summary><ul>${engine.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></details>` : ''}
    </article>`).join('');
  const scale = riskScaleHtml(summary.band);
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta name="author" content="spanier.one"><meta name="description" content="Automatische technische Risikoaufnahme zur digitalen Barrierefreiheit">
<title>${escapeHtml(title)}</title><style>${REPORT_CSS}${ACCESSIBLE_REPORT_CSS}${PRINT_REPORT_CSS}</style></head>
<body>
<header class="site-header"><a class="wordmark" href="${SPANIER_ONE_REPORT_URL}"><span>spanier</span><i aria-hidden="true"></i><span>one</span></a><span class="header-label">Open Accessibility Report</span></header>
<main>
  <section class="cover" aria-labelledby="report-title">
    <div class="cover-copy">
      <p class="eyebrow">Automatische Risikoaufnahme</p>
      <h1 id="report-title">${bookmarkHeadingHtml(title)}</h1>
      <p class="lead">${escapeHtml(result.url)}</p>
      ${options.preparedFor ? `<p class="prepared">Erstellt für <strong>${escapeHtml(options.preparedFor)}</strong></p>` : ''}
    </div>
    <div class="index-card risk-${summary.band}">
      <span class="index-label">Automatischer Befundindex</span>
      <p class="index-number"><strong>${summary.index}</strong><span>/100</span></p>
      <p class="index-status">${escapeHtml(summary.label)}</p>
    </div>
  </section>

  <section class="signal-panel" aria-labelledby="signal-title">
    <div class="signal-copy"><p class="eyebrow">Schnelle Einordnung</p><h2 id="signal-title">${bookmarkHeadingHtml(summary.label)}</h2><p>${escapeHtml(summary.statement)}</p></div>
    ${scale}
    <div class="counts" role="group" aria-label="Automatische Befunde nach Schwere">
      ${summaryMetric('Kritisch', summary.counts.critical, 'critical')}
      ${summaryMetric('Warnungen', summary.counts.warning, 'warning')}
      ${summaryMetric('Hinweise', summary.counts.info, 'info')}
      ${summaryMetric('Engines vollständig', `${summary.engines.completed}/${summary.engines.requested}`, 'engine')}
    </div>
    <div class="score-note"><strong>Was die Zahl bedeutet</strong><p>Der Index verdichtet nur Anzahl und Schwere der automatisch erzeugten Befunde. Er misst weder WCAG-Abdeckung noch rechtliche Konformität. Ein Wert von 0 lässt manuell zu prüfende Barrieren offen.</p></div>
    <a class="expert-link" href="${SPANIER_ONE_REPORT_URL}">Ergebnis mit spanier.one fachlich einordnen <span aria-hidden="true">↗</span></a>
  </section>

  <section class="technical" id="technische-befunde" aria-labelledby="findings-title">
    <div class="section-head"><div><p class="eyebrow">Vollständiger technischer Befund</p><h2 id="findings-title">${bookmarkHeadingHtml(`${result.findings.length} automatisch erzeugte Meldungen`)}</h2></div><p>Regel für Regel, Fundstelle für Fundstelle. Kritische Signale stehen zuerst.</p></div>
    <div class="finding-list">${findings || '<div class="empty"><strong>Keine automatische Auffälligkeit erkannt.</strong><p>Das ist kein Nachweis vollständiger Barrierefreiheit. Tastatur, Screenreader, Zoom, Inhalte und Nutzerwege bleiben manuell zu prüfen.</p></div>'}</div>
  </section>

  <section class="engine-section" aria-labelledby="engines-title">
    <div class="section-head"><div><p class="eyebrow">Prüflauf</p><h2 id="engines-title">Engines&nbsp;<wbr>und&nbsp;<wbr>Grenzen</h2></div><p>${escapeHtml(formatDate(result.completedAt))}</p></div>
    <div class="engine-grid">${engines}</div>
  </section>

  <aside class="final-note"><strong>Automatik findet Signale. Menschen prüfen Wirkung.</strong><p>Dieser Bericht ist eine technische Bestandsaufnahme. Er ersetzt keine dokumentierte manuelle Prüfung und weist keine rechtliche Konformität nach.</p></aside>
</main>
<footer><a href="${SPANIER_ONE_REPORT_URL}">spanier.one</a><span>@spanier-one/barrierefreiheit · ${escapeHtml(formatDate(result.completedAt))}</span></footer>
</body></html>`;
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
    sources: findingSources(finding),
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

function renderFindingHtml(finding: NormalizedFinding, index: number, includeOriginal: boolean): string {
  const selectors = finding.selectors?.length
    ? `<ul class="selectors">${finding.selectors.map((selector) => `<li><code>${escapeHtml(selector)}</code></li>`).join('')}</ul>`
    : '<span>Seitenweit oder ohne automatisch bestimmbare Fundstelle</span>';
  const severityMark = finding.severity === 'critical' ? '!' : finding.severity === 'warning' ? '?' : 'i';
  return `<article class="finding severity-${finding.severity}">
    <div class="finding-index" aria-hidden="true">${String(index + 1).padStart(3, '0')}</div>
    <div class="finding-body">
      <header class="finding-head"><span class="severity"><b aria-hidden="true">${severityMark}</b>${escapeHtml(severityLabel(finding.severity))}</span><code>${escapeHtml(finding.code)}</code></header>
      <h3>${bookmarkHeadingHtml(finding.message)}</h3>
      <dl class="finding-meta">
        <div><dt>Engines / Regeln</dt><dd>${findingSources(finding).map((source) => `<code>${escapeHtml(`${source.engine}/${source.ruleId}`)}</code>`).join('<br>')}</dd></div>
        <div><dt>WCAG-Bezug</dt><dd>${escapeHtml(finding.wcagCriteria?.join(', ') || 'Nicht automatisch zugeordnet')}</dd></div>
        <div><dt>Fundstellen</dt><dd>${selectors}</dd></div>
      </dl>
      ${finding.helpUrl ? `<p class="finding-link"><a href="${escapeHtml(finding.helpUrl)}">Technische Referenz zur Regel <span aria-hidden="true">↗</span></a></p>` : ''}
      ${includeOriginal && finding.originalMessage ? `<details class="original"><summary>Originalmeldung der Engine</summary><p>${escapeHtml(finding.originalMessage)}</p></details>` : ''}
    </div>
  </article>`;
}

function summaryMetric(label: string, value: string | number, style: string): string {
  return `<div class="metric metric-${style}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
}

function riskScaleHtml(activeBand: 'none' | 'low' | 'elevated' | 'high' | 'very-high'): string {
  const bands = [
    ['none', '0', 'Kein Signal'],
    ['low', '1–24', 'Niedrig'],
    ['elevated', '25–49', 'Erhöht'],
    ['high', '50–74', 'Hoch'],
    ['very-high', '75–100', 'Sehr hoch'],
  ] as const;
  return `<div class="risk-scale" role="img" aria-label="Automatischer Befundindex von 0, kein Signal, bis 100, sehr hoch. Aktueller Bereich: ${escapeHtml(bands.find(([band]) => band === activeBand)?.[2] ?? '')}">${bands
    .map(([band, range, label]) => `<span class="band band-${band}${band === activeBand ? ' is-active' : ''}"><b>${range}</b><small>${label}</small></span>`)
    .join('')}</div>`;
}

function checkStatusLabel(status: AccessibilityRunResult['results'][number]['status']): string {
  return status === 'completed' ? 'Abgeschlossen' : status === 'failed' ? 'Fehlgeschlagen' : 'Nicht ausgeführt';
}

function sortedFindings(findings: NormalizedFinding[]): NormalizedFinding[] {
  const order = { critical: 0, warning: 1, info: 2 } as const;
  return [...findings].sort((a, b) => order[a.severity] - order[b.severity] || a.code.localeCompare(b.code));
}

function findingSources(finding: NormalizedFinding): FindingSource[] {
  return finding.sources?.length
    ? finding.sources
    : [{
        engine: finding.engine,
        ruleId: finding.ruleId,
        code: finding.code,
        occurrenceCount: finding.occurrenceCount ?? 1,
      }];
}

function sarifLevel(severity: NormalizedFinding['severity']): 'error' | 'warning' | 'note' {
  return severity === 'critical' ? 'error' : severity === 'warning' ? 'warning' : 'note';
}

function severityLabel(severity: NormalizedFinding['severity']): string {
  return severity === 'critical' ? 'Kritisch' : severity === 'warning' ? 'Warnung' : 'Hinweis';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date(value));
}

function bookmarkHeadingHtml(value: string): string {
  return escapeHtml(value)
    .replaceAll('Barrierefreiheitsbericht', 'Barrierefreiheits<wbr>bericht')
    .replaceAll(' ', '&nbsp;<wbr>');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] ?? character);
}

const ACCESSIBLE_REPORT_CSS = `
.index-card{background-image:none}
.index-card::before{content:none}
.band{color:var(--ink);opacity:1}
.band-none{background:#b8ddcd}.band-low{background:#d5dfb7}.band-elevated{background:#f1dfac}.band-high{background:#f0c5ad}.band-very-high{background:#efb4b1}
.band.is-active{color:#fff}
.band-none.is-active{background:var(--green)}.band-low.is-active{background:var(--olive)}.band-elevated.is-active{background:var(--amber)}.band-high.is-active{background:var(--orange)}.band-very-high.is-active{background:var(--red)}
`;

const PRINT_REPORT_CSS = `
@media print{
  .cover h1{font-size:36pt;overflow-wrap:anywhere;hyphens:none}
  .technical{padding:12mm 0}
  .section-head{margin-bottom:8mm}
  .finding{position:relative;display:block;padding-left:18mm;break-inside:avoid-page;page-break-inside:avoid}
  .finding-index{position:absolute;left:0;top:0;padding:4mm 2mm;font-size:6.5pt}
  .finding-body{padding:4mm 0}
  .finding-head>code{font-size:6.5pt}
  .severity{font-size:7pt}
  .severity b{width:5mm;height:5mm}
  .finding h3{max-width:none;margin:3mm 0;font-size:12.5pt}
  .finding-meta>div{grid-template-columns:31mm 1fr;gap:4mm;padding:1.8mm 0}
  dt{font-size:6.2pt}
  dd{font-size:8.5pt}
  .selectors code{padding:1mm 2mm}
  .finding-link,.original{margin-top:2mm;font-size:8pt}
}`;

const REPORT_CSS = `
:root{--ink:#101625;--muted:#596174;--paper:#fff;--wash:#eef1ff;--line:#d9deeb;--blue:#1848e5;--lime:#dcff55;--green:#157347;--olive:#58751d;--amber:#8a6700;--orange:#ad4a16;--red:#b42318;font-family:Arial,Helvetica,sans-serif;color:var(--ink);background:#e9edf8;line-height:1.55}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0}a{color:inherit}a:focus-visible,summary:focus-visible{outline:3px solid var(--blue);outline-offset:4px}.site-header,main,footer{width:min(1180px,calc(100% - 40px));margin-inline:auto}.site-header{display:flex;justify-content:space-between;align-items:center;padding:30px 0 24px}.wordmark{display:flex;align-items:center;gap:4px;color:var(--ink);font-size:28px;font-weight:900;letter-spacing:-.055em;text-decoration:none}.wordmark i{width:9px;height:9px;border-radius:50%;background:var(--lime);box-shadow:0 0 0 3px var(--ink)}.header-label{font:800 11px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}main{overflow:hidden;background:var(--paper);box-shadow:0 22px 70px rgba(17,31,76,.12)}.cover{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(280px,.55fr);min-height:470px;color:#fff;background:var(--ink)}.cover-copy{display:flex;flex-direction:column;justify-content:flex-end;padding:64px}.eyebrow{margin:0 0 13px;color:var(--blue);font:900 11px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.13em;text-transform:uppercase}.cover .eyebrow{color:var(--lime)}h1,h2,h3,p{margin-top:0}h1{max-width:14ch;margin-bottom:24px;font-size:clamp(42px,6vw,76px);font-weight:900;line-height:.92;letter-spacing:-.065em}.lead{max-width:48ch;margin-bottom:0;color:#cfd6e8;font:600 16px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.prepared{margin:22px 0 0;color:#cfd6e8}.index-card{position:relative;display:flex;flex-direction:column;justify-content:flex-end;padding:46px 36px;color:#fff;background:var(--red);isolation:isolate}.index-card::before{position:absolute;inset:0;z-index:-1;content:"";opacity:.22;background:repeating-linear-gradient(-45deg,transparent 0 10px,#fff 10px 12px)}.risk-none{background:var(--green)}.risk-low{background:var(--olive)}.risk-elevated{background:var(--amber)}.risk-high{background:var(--orange)}.risk-very-high{background:var(--red)}.index-label{font:900 10px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.1em;text-transform:uppercase}.index-number{display:flex;align-items:baseline;margin:20px 0 4px;line-height:1}.index-number strong{font-size:clamp(76px,10vw,130px);letter-spacing:-.08em}.index-number span{font-size:18px;font-weight:800}.index-status{max-width:18ch;margin:0;font-size:18px;font-weight:900;line-height:1.1}.signal-panel,.technical,.engine-section{padding:64px}.signal-panel{display:grid;grid-template-columns:1fr;gap:28px;background:#f7f8fd}.signal-copy{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);column-gap:48px;align-items:end}.signal-copy .eyebrow{grid-column:1/-1}.signal-copy h2,.section-head h2{margin:0;font-size:clamp(30px,4vw,48px);line-height:1;letter-spacing:-.045em}.signal-copy p:last-child{margin:0;color:var(--muted);font-size:18px}.risk-scale{display:grid;grid-template-columns:repeat(5,1fr);gap:5px}.band{position:relative;min-height:78px;padding:15px 12px;border:2px solid transparent;color:#fff;opacity:.48}.band b,.band small{display:block}.band b{font:900 13px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace}.band small{margin-top:8px;font-size:11px;font-weight:800}.band-none{background:var(--green)}.band-low{background:var(--olive)}.band-elevated{background:var(--amber)}.band-high{background:var(--orange)}.band-very-high{background:var(--red)}.band.is-active{border-color:var(--ink);opacity:1;transform:translateY(-5px);box-shadow:0 8px 0 var(--ink)}.band.is-active::after{position:absolute;right:9px;top:8px;content:"●"}.counts{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);background:#fff}.metric{min-height:120px;padding:20px;border-left:1px solid var(--line)}.metric:first-child{border-left:0}.metric span,.metric strong{display:block}.metric span{color:var(--muted);font:800 10px/1.25 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.06em;text-transform:uppercase}.metric strong{margin-top:18px;font-size:38px;line-height:1}.metric-critical strong{color:var(--red)}.metric-warning strong{color:var(--amber)}.metric-info strong{color:var(--blue)}.score-note{display:grid;grid-template-columns:180px 1fr;gap:20px;padding:24px;border-left:6px solid var(--lime);background:var(--ink);color:#fff}.score-note strong{font-size:18px}.score-note p{margin:0;color:#cfd6e8}.expert-link{justify-self:start;padding:13px 18px;border:2px solid var(--ink);font-weight:900;text-decoration:none;box-shadow:5px 5px 0 var(--lime)}.expert-link:hover{transform:translate(-1px,-1px);box-shadow:7px 7px 0 var(--lime)}.technical{padding-top:86px}.section-head{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(220px,.55fr);gap:40px;align-items:end;margin-bottom:42px}.section-head>p{margin:0;color:var(--muted)}.finding-list{border-top:4px solid var(--ink)}.finding{display:grid;grid-template-columns:72px 1fr;border-bottom:1px solid var(--line)}.finding-index{padding:27px 12px;color:var(--muted);font:800 11px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace}.finding-body{padding:25px 0 30px}.finding-head{display:flex;gap:14px;align-items:center;justify-content:space-between}.finding-head>code{color:var(--muted);font-size:11px}.severity{display:inline-flex;align-items:center;gap:8px;font:900 10px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.08em;text-transform:uppercase}.severity b{display:grid;width:22px;height:22px;place-items:center;border-radius:50%;color:#fff}.severity-critical .severity{color:var(--red)}.severity-critical .severity b{background:var(--red)}.severity-warning .severity{color:var(--amber)}.severity-warning .severity b{background:var(--amber)}.severity-info .severity{color:var(--blue)}.severity-info .severity b{background:var(--blue)}.finding h3{max-width:35ch;margin:18px 0 24px;font-size:24px;line-height:1.15;letter-spacing:-.025em}.finding-meta{margin:0}.finding-meta>div{display:grid;grid-template-columns:145px 1fr;gap:18px;padding:11px 0;border-top:1px dashed var(--line)}dt{color:var(--muted);font:800 10px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;text-transform:uppercase}dd{min-width:0;margin:0}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.selectors{margin:0;padding:0;list-style:none}.selectors li+li{margin-top:7px}.selectors code{display:block;padding:6px 9px;background:var(--wash)}.finding-link{margin:18px 0 0;font-weight:800}.original{margin-top:16px}.original summary,.engine-card summary{cursor:pointer;font-weight:800}.empty{padding:35px 0}.engine-section{background:var(--wash)}.engine-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.engine-card{padding:24px;background:#fff}.engine-card>div{display:flex;flex-direction:column-reverse;align-items:flex-start}.engine-card h3{margin:9px 0 0;font:900 20px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.engine-card p{color:var(--muted)}.engine-status{padding:4px 7px;color:#fff;background:var(--muted);font:900 9px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;text-transform:uppercase}.status-completed{background:var(--green)}.status-failed{background:var(--red)}.engine-card details{border-top:1px solid var(--line);padding-top:12px}.engine-card ul{padding-left:20px}.final-note{display:grid;grid-template-columns:.8fr 1.2fr;gap:36px;margin:0;padding:48px 64px;color:#fff;background:var(--blue)}.final-note strong{font-size:24px;line-height:1.05}.final-note p{margin:0;color:#e2e8ff}footer{display:flex;justify-content:space-between;gap:20px;padding:24px 0 44px;color:var(--muted);font-size:12px}footer a{color:var(--ink);font-weight:900}@media(max-width:760px){.site-header,main,footer{width:100%}.site-header,footer{padding-inline:20px}.header-label{font-size:9px}.cover{grid-template-columns:1fr}.cover-copy{min-height:410px;padding:42px 24px}.index-card{min-height:280px;padding:34px 24px}.signal-panel,.technical,.engine-section{padding:44px 24px}.signal-copy,.section-head,.score-note,.final-note{grid-template-columns:1fr}.risk-scale{grid-template-columns:1fr}.band{min-height:auto}.band.is-active{transform:none;box-shadow:5px 5px 0 var(--ink)}.counts{grid-template-columns:1fr 1fr}.metric:nth-child(3){border-left:0}.metric{border-bottom:1px solid var(--line)}.finding{grid-template-columns:44px 1fr}.finding-index{padding-left:0}.finding-head{align-items:flex-start;flex-direction:column}.finding-meta>div{grid-template-columns:1fr;gap:3px}.engine-grid{grid-template-columns:1fr}.final-note{padding:38px 24px}footer{flex-direction:column}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.expert-link{transition:none}}@media print{@page{size:A4;margin:12mm 12mm 15mm}:root{background:#fff}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.site-header{width:100%;height:16mm;padding:0}.wordmark{font-size:22px}.header-label{font-size:8px}main{width:100%;overflow:visible;box-shadow:none}.cover{grid-template-columns:minmax(0,1.45fr) minmax(58mm,.55fr);min-height:238mm;break-after:page}.cover-copy{padding:16mm 12mm}.cover h1{font-size:43pt}.index-card{padding:14mm 8mm}.index-number strong{font-size:72pt}.signal-panel{min-height:260mm;padding:18mm 12mm;break-after:page}.signal-copy h2,.section-head h2{font-size:28pt}.expert-link{box-shadow:4px 4px 0 var(--lime)}.technical{padding:14mm 0}.section-head{margin-bottom:10mm}.finding{break-inside:avoid}.finding-body{padding:6mm 0}.finding h3{font-size:16pt}.engine-section{padding:14mm 10mm;break-before:page}.engine-card{break-inside:avoid}.final-note{break-inside:avoid;padding:10mm}.site-header a,.expert-link,footer a{text-decoration:none}footer{width:100%;padding:8mm 0 0}}`;
