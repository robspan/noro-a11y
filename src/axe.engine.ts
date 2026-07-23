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
const LOCALIZED_AXE_RUNTIME = loadGermanAxeLocale().then((locale) => ({
  locale,
  source: `${axe.source}\naxe.configure({ locale: ${JSON.stringify(locale)} });`,
}));

export async function axeRuntimeSource(): Promise<string> {
  return (await LOCALIZED_AXE_RUNTIME).source;
}

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

  const { locale: deLocale, source: localizedAxeSource } =
    await LOCALIZED_AXE_RUNTIME;
  const runtimeIsPreloaded = await input.page
    .evaluate((expectedVersion) => {
      const runtime = (
        window as typeof window & {
          axe?: { version?: string; runPartial?: unknown };
        }
      ).axe;
      return (
        runtime?.version === expectedVersion &&
        typeof runtime.runPartial === 'function'
      );
    }, axe.version)
    .catch(() => false);
  const germanRules = deLocale.rules as Record<string, { help?: string }>;
  const results = await new AxeBuilder({
    page: input.page,
    axeSource: runtimeIsPreloaded ? 'void 0' : localizedAxeSource,
  })
    .options({
      // Full node detail is only consumed for findings and manual review.
      // Axe still returns every passing rule with one representative node,
      // which preserves criterion outcomes while avoiding selector generation
      // for thousands of passing nodes.
      resultTypes: ['violations', 'incomplete'],
    })
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
  const prefix = translatedHelp ?? `Axe meldet einen Befund zur Regel „${item.id}“`;
  const normalizedPrefix = prefix.replace(/[.:;!?]+$/u, '');
  const reviewSuffix = incomplete ? ' – manuell prüfen' : '';
  return normalizedFinding({
    engine: 'axe',
    ruleId: `${incomplete ? 'manual-review' : 'violation'}-${item.id}`,
    severity: incomplete ? 'warning' : severityForImpact(item.impact),
    message: `${normalizedPrefix}${reviewSuffix}: ${count} betroffene${count === 1 ? 's Element' : ' Elemente'}.`,
    translationStatus: translatedHelp ? 'engine-locale' : 'fallback',
    originalMessage: `${item.help}: ${item.description}`,
    wcagCriteria: wcagCriteria(item.tags),
    helpUrl: item.helpUrl,
    selectors: item.nodes.slice(0, 5).map(({ target }) => target.flat().join(' > ')),
    occurrenceCount: count,
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
