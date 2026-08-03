import { randomUUID } from 'node:crypto';
import axe from 'axe-core';
import type { AxeResults, Result, RunOptions } from 'axe-core';
import axeTags from './axe-wcag-tags.json' with { type: 'json' };
import { normalizedFinding } from './catalog.ts';
import type {
  AccessibilityImpact,
  AccessibilityRunInput,
  AutomatedCriterionOutcome,
  AutomatedCriterionResult,
  AutomatedRuleObservation,
  EngineResult,
  FindingSeverity,
} from './types.ts';

const AXE_TAGS = axeTags;
const AXE_RULES = new Map(
  axe.getRules(AXE_TAGS).map((rule) => [rule.ruleId, rule] as const),
);
const AXE_RULE_IDS = [...AXE_RULES.keys()].sort();
const AXE_RUN_OPTIONS: RunOptions = {
  runOnly: {
    type: 'rule',
    values: AXE_RULE_IDS,
  },
  resultTypes: ['violations', 'incomplete', 'passes', 'inapplicable'],
  // The screening evaluates the containing document. Embedded documents are
  // separate audit targets and are called out explicitly as a limitation.
  iframes: false,
};
const AXE_RUNTIME_ATTESTATION_PROPERTY =
  `__spanier_one_axe_${randomUUID().replaceAll('-', '')}`;
const AXE_RUNTIME_ATTESTATION_VALUE = randomUUID();
const LOCALIZED_AXE_RUNTIME = loadGermanAxeLocale().then((locale) => ({
  locale,
  source: `${axe.source}
axe.configure({ locale: ${JSON.stringify(locale)} });
(() => {
  const trustedAxe = axe;
  const facade = {
    version: trustedAxe.version,
    run(context, options) {
      return trustedAxe.run(context, options);
    }
  };
  Object.defineProperty(facade, ${JSON.stringify(AXE_RUNTIME_ATTESTATION_PROPERTY)}, {
    value: ${JSON.stringify(AXE_RUNTIME_ATTESTATION_VALUE)},
    configurable: false,
    enumerable: false,
    writable: false
  });
  Object.freeze(facade);
  Object.defineProperty(window, 'axe', {
    value: facade,
    configurable: false,
    enumerable: true,
    writable: false
  });
})();`,
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
  const germanRules = deLocale.rules as Record<string, { help?: string }>;
  const runtimeStatus = await input.page.evaluate(
    ({ attestationProperty, attestationValue, expectedVersion }) => {
      type AxeRuntime = {
        version?: string;
        run?: unknown;
        [key: string]: unknown;
      };
      const axeWindow = window as typeof window & { axe?: AxeRuntime };
      const runtime = axeWindow.axe;
      if (
        runtime?.[attestationProperty] === attestationValue &&
        runtime.version === expectedVersion &&
        typeof runtime.run === 'function' &&
        Object.isFrozen(runtime)
      ) {
        return 'attested';
      }
      try {
        return delete axeWindow.axe ? 'injectable' : 'blocked';
      } catch {
        return 'blocked';
      }
    },
    {
      attestationProperty: AXE_RUNTIME_ATTESTATION_PROPERTY,
      attestationValue: AXE_RUNTIME_ATTESTATION_VALUE,
      expectedVersion: axe.version,
    },
  );
  if (runtimeStatus === 'blocked') {
    throw new Error('A non-replaceable, untrusted axe runtime is present.');
  }
  if (runtimeStatus === 'injectable') {
    await injectAxeRuntimeFromBrowserProtocol(input.page, localizedAxeSource);
  }
  const results = validateAxeResults(await input.page.evaluate(
    async ({
      attestationProperty,
      attestationValue,
      expectedVersion,
      options,
    }): Promise<AxeResults> => {
      type AxeRuntime = {
        version?: string;
        run?: (
          context: Document,
          runOptions: RunOptions,
        ) => Promise<AxeResults>;
        [key: string]: unknown;
      };
      const axeWindow = window as typeof window & { axe?: AxeRuntime };
      const runtime = axeWindow.axe;

      if (
        runtime?.[attestationProperty] !== attestationValue ||
        runtime.version !== expectedVersion ||
        typeof runtime.run !== 'function' ||
        !Object.isFrozen(runtime)
      ) {
        throw new Error('axe-core runtime attestation failed.');
      }
      return runtime.run(document, options);
    },
    {
      attestationProperty: AXE_RUNTIME_ATTESTATION_PROPERTY,
      attestationValue: AXE_RUNTIME_ATTESTATION_VALUE,
      expectedVersion: axe.version,
      options: AXE_RUN_OPTIONS,
    },
  ));
  const violations = results.violations.map((item) => axeFinding(item, false, germanRules));
  const manualReview = results.incomplete.map((item) => axeFinding(item, true, germanRules));
  const rulesConfigured = new Set([
    ...results.passes,
    ...results.incomplete,
    ...results.violations,
    ...results.inapplicable,
  ].map(({ id }) => id)).size;

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
    scoreRules: [
      ...scoreRuleObservations(results.passes, 'passed', results.testEngine.version),
      ...scoreRuleObservations(results.incomplete, 'manual', results.testEngine.version),
      ...scoreRuleObservations(results.violations, 'failed', results.testEngine.version),
      ...scoreRuleObservations(results.inapplicable, 'inapplicable', results.testEngine.version),
    ],
    metadata: {
      axeVersion: results.testEngine.version,
      rulesConfigured,
      ruleEvaluations:
        results.passes.length +
        results.incomplete.length +
        results.violations.length +
        results.inapplicable.length,
      rulesWithoutFindings: results.passes.length,
      rulesWithoutRelevantContent: results.inapplicable.length,
      rulesWithViolations: violations.length,
      rulesNeedingManualReview: manualReview.length,
      violationNodes: results.violations.reduce((sum, item) => sum + item.nodes.length, 0),
      incompleteNodes: results.incomplete.reduce((sum, item) => sum + item.nodes.length, 0),
      standardTags: AXE_TAGS.join(', '),
    },
    limitations: [
      'Axe deckt ausschließlich automatisierbare Teilprüfungen ab.',
      'Geprüft wird der sichtbare Dokumentzustand; eingebettete Dokumente, geschlossene Bedienelemente und weitere Interaktionszustände werden nicht automatisch vertieft.',
      'Tastatur, Screenreader, Zoom, Inhalte und vollständige Nutzerwege benötigen eine professionelle manuelle Prüfung.',
      'Ein fehlerfreier Axe-Lauf ist kein Konformitätsnachweis.',
    ],
  };
}

async function injectAxeRuntimeFromBrowserProtocol(
  page: NonNullable<AccessibilityRunInput['page']>,
  source: string,
): Promise<void> {
  let session;
  try {
    session = await page.context().newCDPSession(page);
  } catch {
    throw new Error(
      'A trusted axe-core fallback injection requires a Chromium CDP session.',
    );
  }
  try {
    const response = await session.send('Runtime.evaluate', {
      expression: source,
      awaitPromise: true,
      returnByValue: true,
    }) as { exceptionDetails?: { text?: string } };
    if (response.exceptionDetails) {
      throw new Error(
        `axe-core runtime injection failed: ${response.exceptionDetails.text ?? 'browser exception'}`,
      );
    }
  } finally {
    await session.detach();
  }
}

async function loadGermanAxeLocale(): Promise<{ rules: Record<string, { help?: string }> }> {
  const module = await import('axe-core/locales/de.json', { with: { type: 'json' } });
  return module.default as { rules: Record<string, { help?: string }> };
}

function axeFinding(item: Result, incomplete: boolean, germanRules: Record<string, { help?: string }>) {
  const rule = canonicalAxeRule(item.id);
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
    originalMessage: `${rule.help}: ${rule.description}`,
    wcagCriteria: wcagCriteria(rule.tags),
    helpUrl: rule.helpUrl,
    selectors: item.nodes.slice(0, 5).map(({ target }) => selectorText(target)),
    occurrenceCount: count,
  });
}

function criterionResults(items: Result[], outcome: AutomatedCriterionOutcome): AutomatedCriterionResult[] {
  return items.flatMap((item) => wcagCriteria(canonicalAxeRule(item.id).tags).map((criterion) => ({
    criterion,
    outcome,
    source: `axe.${item.id}`,
  })));
}

function scoreRuleObservations(
  items: Result[],
  outcome: 'passed' | 'failed' | 'manual' | 'inapplicable',
  ruleVersion: string,
): AutomatedRuleObservation[] {
  return items.map((item) => ({
    engine: 'axe',
    ruleId: item.id,
    ruleVersion,
    impact: accessibilityImpact(item.impact),
    wcagCriteria: wcagCriteria(canonicalAxeRule(item.id).tags),
    passedTargets: outcome === 'passed' ? item.nodes.length : 0,
    failedTargets: outcome === 'failed' ? item.nodes.length : 0,
    affectedPages: outcome === 'failed' && item.nodes.length > 0 ? 1 : 0,
    manualTargets: outcome === 'manual' ? item.nodes.length : 0,
    inapplicableEvaluations: outcome === 'inapplicable' ? 1 : 0,
  }));
}

function canonicalAxeRule(ruleId: string): ReturnType<typeof axe.getRules>[number] {
  const rule = AXE_RULES.get(ruleId);
  if (!rule) throw new Error(`axe-core returned an unknown rule: ${ruleId}`);
  return rule;
}

function validateAxeResults(value: AxeResults): AxeResults {
  if (
    !value ||
    typeof value !== 'object' ||
    value.testEngine?.name !== 'axe-core' ||
    value.testEngine.version !== axe.version
  ) {
    throw new Error('axe-core returned an untrusted engine identity.');
  }

  const buckets = [
    value.passes,
    value.incomplete,
    value.violations,
    value.inapplicable,
  ];
  if (buckets.some((bucket) => !Array.isArray(bucket))) {
    throw new Error('axe-core returned an invalid result structure.');
  }

  const seenRules = new Set<string>();
  for (const bucket of buckets) {
    const seenRulesInBucket = new Set<string>();
    for (const result of bucket) {
      if (
        !result ||
        typeof result.id !== 'string' ||
        !AXE_RULES.has(result.id) ||
        seenRulesInBucket.has(result.id) ||
        !Array.isArray(result.nodes) ||
        !result.nodes.every(({ target }) => validSelectorTarget(target))
      ) {
        throw new Error('axe-core returned an invalid or unexpected rule result.');
      }
      seenRulesInBucket.add(result.id);
      seenRules.add(result.id);
    }
  }
  if (seenRules.size !== AXE_RULE_IDS.length) {
    throw new Error(
      `axe-core returned ${seenRules.size} of ${AXE_RULE_IDS.length} configured rules.`,
    );
  }
  return value;
}

function validSelectorTarget(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 100 &&
    value.every((part) => validCrossTreeSelector(part))
  );
}

function validCrossTreeSelector(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.length > 0 && value.length <= 10_000;
  }
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.length <= 100 &&
    value.every((part) =>
      typeof part === 'string' && part.length > 0 && part.length <= 10_000)
  );
}

function selectorText(value: unknown): string {
  const selectors: string[] = [];
  const collect = (part: unknown): void => {
    if (typeof part === 'string') {
      selectors.push(part);
      return;
    }
    if (Array.isArray(part)) part.forEach(collect);
  };
  collect(value);
  return selectors.join(' > ');
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

function accessibilityImpact(
  impact: string | null | undefined,
): AccessibilityImpact {
  if (
    impact === 'critical' ||
    impact === 'serious' ||
    impact === 'moderate' ||
    impact === 'minor'
  ) {
    return impact;
  }
  return 'minor';
}
