import { AxeBuilder } from '@axe-core/playwright';
import axe from 'axe-core';
import type { Result } from 'axe-core';
import { normalizedFinding } from './catalog.ts';
import type {
  AccessibilityRunInput,
  AutomatedCriterionOutcome,
  AutomatedCriterionResult,
  EngineResult,
  FindingSeverity,
} from './types.ts';

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

export async function runAxeEngine(input: AccessibilityRunInput): Promise<EngineResult> {
  if (!input.page) {
    return {
      engine: 'axe',
      status: 'not_run',
      summary: 'Axe wurde nicht ausgeführt, weil keine gerenderte Browserseite übergeben wurde.',
      findings: [],
      limitations: ['Für Axe muss eine Playwright-Seite übergeben werden.'],
    };
  }

  const deLocale = await loadGermanAxeLocale();
  const localizedAxeSource = `${axe.source}\naxe.configure({ locale: ${JSON.stringify(deLocale)} });`;
  const germanRules = deLocale.rules as Record<string, { help?: string }>;
  const results = await new AxeBuilder({ page: input.page, axeSource: localizedAxeSource })
    .withTags(AXE_TAGS)
    .analyze();
  const violations = results.violations.map((item) => axeFinding(item, false, germanRules));
  const manualReview = results.incomplete.map((item) => axeFinding(item, true, germanRules));

  return {
    engine: 'axe',
    status: 'completed',
    summary: `Axe meldet ${violations.length} Regelverstöße; ${manualReview.length} Ergebnisse benötigen eine manuelle Prüfung.`,
    findings: [...violations, ...manualReview],
    criterionResults: [
      ...criterionResults(results.passes, 'passed'),
      ...criterionResults(results.incomplete, 'needs-review'),
      ...criterionResults(results.violations, 'failed'),
    ],
    metadata: {
      rulesWithViolations: violations.length,
      rulesNeedingManualReview: manualReview.length,
      violationNodes: results.violations.reduce((sum, item) => sum + item.nodes.length, 0),
      incompleteNodes: results.incomplete.reduce((sum, item) => sum + item.nodes.length, 0),
      standardTags: AXE_TAGS.join(', '),
    },
    limitations: [
      'Axe deckt ausschließlich automatisierbare Teilprüfungen ab.',
      'Tastatur, Screenreader, Zoom, Inhalte und vollständige Nutzerwege benötigen eine manuelle Prüfung.',
      'Ein fehlerfreier Axe-Lauf ist kein Konformitätsnachweis.',
    ],
  };
}

async function loadGermanAxeLocale(): Promise<{ rules: Record<string, { help?: string }> }> {
  const module = await import('axe-core/locales/de.json', { with: { type: 'json' } });
  return module.default as { rules: Record<string, { help?: string }> };
}

function axeFinding(item: Result, incomplete: boolean, germanRules: Record<string, { help?: string }>) {
  const count = item.nodes.length;
  const translatedHelp = germanRules[item.id]?.help;
  const prefix = incomplete
    ? 'Manuelle Prüfung erforderlich'
    : translatedHelp ?? `Axe meldet einen Verstoß gegen die Regel „${item.id}“`;
  const normalizedPrefix = prefix.replace(/[.:;!?]+$/u, '');
  return normalizedFinding({
    engine: 'axe',
    ruleId: `${incomplete ? 'manual-review' : 'violation'}-${item.id}`,
    severity: incomplete ? 'warning' : severityForImpact(item.impact),
    message: `${normalizedPrefix}: ${count} betroffene${count === 1 ? 's Element' : ' Elemente'}.`,
    translationStatus: incomplete || translatedHelp ? 'engine-locale' : 'fallback',
    originalMessage: `${item.help}: ${item.description}`,
    wcagCriteria: wcagCriteria(item.tags),
    helpUrl: item.helpUrl,
    selectors: item.nodes.slice(0, 5).map(({ target }) => target.flat().join(' > ')),
  });
}

function criterionResults(items: Result[], outcome: AutomatedCriterionOutcome): AutomatedCriterionResult[] {
  return items.flatMap((item) => wcagCriteria(item.tags).map((criterion) => ({
    criterion,
    outcome,
    source: `axe.${item.id}`,
  })));
}

function wcagCriteria(tags: string[]): string[] {
  return [...new Set(tags.map(wcagCriterion).filter((value): value is string => Boolean(value)))];
}

function wcagCriterion(tag: string): string | undefined {
  const digits = /^wcag(\d)(\d)(\d{1,2})$/i.exec(tag);
  return digits ? `${digits[1]}.${digits[2]}.${digits[3]}` : undefined;
}

function severityForImpact(impact: string | null | undefined): FindingSeverity {
  if (impact === 'critical' || impact === 'serious') return 'critical';
  if (impact === 'moderate') return 'warning';
  return 'info';
}
