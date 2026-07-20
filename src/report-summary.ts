import type {
  AccessibilityRunResult,
  AutomatedRiskBand,
  AutomatedRiskSummary,
  FindingSeverity,
} from './types.ts';

export const SPANIER_ONE_REPORT_URL =
  'https://spanier.one/?utm_source=opensource_report&utm_medium=report&utm_campaign=spanier_one_a11y';

const FINDING_WEIGHT: Record<FindingSeverity, number> = {
  critical: 20,
  warning: 8,
  info: 2,
};

/**
 * Verdichtet Anzahl und Schwere automatischer Befunde zu einem Signalwert.
 * Der Wert misst weder WCAG-Abdeckung noch Konformität und ist bei 100 gedeckelt.
 */
export function summarizeAutomatedRisk(result: AccessibilityRunResult): AutomatedRiskSummary {
  const counts = result.findings.reduce<Record<FindingSeverity, number>>(
    (summary, finding) => ({ ...summary, [finding.severity]: summary[finding.severity] + 1 }),
    { critical: 0, warning: 0, info: 0 },
  );
  const engines = {
    requested: result.requestedEngines.length,
    completed: result.results.filter(({ status }) => status === 'completed').length,
    failed: result.results.filter(({ status }) => status === 'failed').length,
    notRun: result.results.filter(({ status }) => status === 'not_run').length,
  };
  const findingPoints = (Object.keys(counts) as FindingSeverity[])
    .reduce((sum, severity) => sum + counts[severity] * FINDING_WEIGHT[severity], 0);
  const index = Math.min(100, findingPoints + engines.failed * 15 + engines.notRun * 5);
  const band = bandFor(index);

  return {
    index,
    band,
    label: bandLabel(band),
    statement: bandStatement(band),
    counts,
    engines,
  };
}

function bandFor(index: number): AutomatedRiskBand {
  if (index === 0) return 'none';
  if (index < 25) return 'low';
  if (index < 50) return 'elevated';
  if (index < 75) return 'high';
  return 'very-high';
}

function bandLabel(band: AutomatedRiskBand): string {
  const labels: Record<AutomatedRiskBand, string> = {
    none: 'Kein automatisches Risikosignal',
    low: 'Niedriges Risikosignal',
    elevated: 'Erhöhtes Risikosignal',
    high: 'Hohes Risikosignal',
    'very-high': 'Sehr hohes Risikosignal',
  };
  return labels[band];
}

function bandStatement(band: AutomatedRiskBand): string {
  const statements: Record<AutomatedRiskBand, string> = {
    none: 'Die Automatik hat keine Auffälligkeit erkannt. Manuell zu prüfende Bereiche bleiben trotzdem offen.',
    low: 'Wenige technische Signale sollten fachlich eingeordnet und gezielt nachgeprüft werden.',
    elevated: 'Mehrere technische Signale sprechen für eine strukturierte Prüfung und Priorisierung.',
    high: 'Die Automatik zeigt deutlichen technischen Handlungsbedarf in den geprüften Bereichen.',
    'very-high': 'Die geprüfte Seite zeigt ein starkes technisches Risikosignal und sollte fachlich priorisiert werden.',
  };
  return statements[band];
}
