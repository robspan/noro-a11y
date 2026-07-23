import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { normalizedFinding } from './catalog.ts';
import type {
  AccessibilityRunInput,
  AutomatedCriterionOutcome,
  AutomatedCriterionResult,
  EngineResult,
  FindingSeverity,
  NormalizedFinding,
} from './types.ts';

const moduleRequire = createRequire(
  typeof __filename === 'string' ? __filename : import.meta.url,
);
const IBM_RULESET_ID = 'IBM_Accessibility';
const IBM_HELP_URL = 'https://www.ibm.com/able/requirements/checker-rule-sets/';
const IBM_RUNTIME_SOURCE = readFile(
  moduleRequire.resolve('accessibility-checker-engine/ace.js'),
  'utf8',
);

const IBM_MESSAGES: Readonly<Partial<Record<string, (count: number) => string>>> = {
  a_text_purpose: (count) =>
    `${count} Link${count === 1 ? ' benötigt' : 's benötigen'} einen verständlichen zugänglichen Namen.`,
  aria_hidden_nontabbable: (count) =>
    `${count} fokussierbare${count === 1 ? 's Element ist' : ' Elemente sind'} vor assistiver Technik verborgen.`,
  aria_landmark_name_unique: () =>
    'Mehrere gleichartige Orientierungspunkte benötigen eindeutige Namen.',
  html_lang_exists: () => 'Am HTML-Element fehlt eine gültige Seitensprache.',
  img_alt_valid: (count) =>
    `${count} Bildelement${count === 1 ? '' : 'e'} ohne geeigneten Alternativtext gefunden.`,
  input_label_exists: (count) =>
    `${count} Formularfeld${count === 1 ? ' besitzt' : 'er besitzen'} keine programmatisch zugeordnete Beschriftung.`,
  page_title_exists: () => 'Das Dokument besitzt keinen aussagekräftigen Titel.',
  skip_main_exists: () =>
    'Die Seite bietet keinen eindeutig erkennbaren Hauptbereich oder Sprunglink.',
};

interface IbmRawIssue {
  ruleId: string;
  reasonId?: string;
  policy: string;
  confidence: string;
  message: string;
  selector?: string;
  criteria: string[];
}

interface IbmRawResult {
  issues: IbmRawIssue[];
  criteria: AutomatedCriterionResult[];
  numExecuted: number;
  ruleTime: number;
  rulesetName: string;
}

export async function ibmRuntimeSource(): Promise<string> {
  return IBM_RUNTIME_SOURCE;
}

export async function runIbmEngine(input: AccessibilityRunInput): Promise<EngineResult> {
  if (!input.page) {
    return {
      engine: 'ibm',
      status: 'not_run',
      summary: 'IBM Equal Access wurde nicht ausgeführt, weil keine gerenderte Browserseite übergeben wurde.',
      findings: [],
      limitations: ['Für IBM Equal Access muss eine Playwright-Seite übergeben werden.'],
    };
  }

  await ensureIbmRuntime(input);
  const result = await collectIbmResults(input);
  const findings = normalizeIbmIssues(result.issues);
  const manualReviewCount = findings.filter(({ code }) => code.includes('manual-review')).length;

  return {
    engine: 'ibm',
    status: 'completed',
    summary: `IBM Equal Access meldet ${findings.length - manualReviewCount} Regelverstöße; ${manualReviewCount} Ergebnisse benötigen eine manuelle Prüfung.`,
    findings,
    criterionResults: result.criteria,
    metadata: {
      rulesExecuted: result.numExecuted,
      ruleTimeMs: result.ruleTime,
      ruleset: result.rulesetName,
      rulesWithFindings: findings.length,
      issueNodes: result.issues.length,
    },
    limitations: [
      'IBM Equal Access deckt ausschließlich automatisierbare Teilprüfungen ab.',
      'Potenzielle Befunde benötigen eine manuelle Verifikation.',
      'Ein fehlerfreier IBM-Lauf ist kein Konformitätsnachweis.',
    ],
  };
}

async function ensureIbmRuntime(input: AccessibilityRunInput): Promise<void> {
  const available = await input.page?.evaluate(() => {
    const runtime = (globalThis as typeof globalThis & {
      ace?: { Checker?: new () => { getGuidelineIds?: () => string[] } };
    }).ace;
    if (typeof runtime?.Checker !== 'function') return false;
    try {
      return new runtime.Checker().getGuidelineIds?.().includes('IBM_Accessibility') ?? false;
    } catch {
      return false;
    }
  }).catch(() => false);
  if (available) return;

  await input.page?.evaluate(await IBM_RUNTIME_SOURCE);
}

async function collectIbmResults(input: AccessibilityRunInput): Promise<IbmRawResult> {
  return input.page!.evaluate(async (rulesetId) => {
    interface BrowserIssue {
      ruleId: string;
      reasonId?: string | number;
      value?: [string, string];
      message?: string;
      node?: Node;
      path?: Record<string, string>;
    }
    interface BrowserGuideline {
      id: string;
      name: string;
      checkpoints?: Array<{
        num: string;
        rules?: Array<{ id: string }>;
      }>;
    }
    interface BrowserChecker {
      check(node: Document, guidelineIds: string[]): Promise<{
        results: BrowserIssue[];
        numExecuted: number;
        ruleTime: number;
      }>;
      getGuidelines(): BrowserGuideline[];
    }
    const runtime = (globalThis as typeof globalThis & {
      ace?: { Checker?: new () => BrowserChecker };
    }).ace;
    if (typeof runtime?.Checker !== 'function') {
      throw new Error('IBM Equal Access runtime is unavailable.');
    }

    const checker = new runtime.Checker();
    const guideline = checker.getGuidelines().find(({ id }) => id === rulesetId);
    if (!guideline) throw new Error(`IBM Equal Access ruleset is unavailable: ${rulesetId}`);
    const criteriaByRule = new Map<string, Set<string>>();
    for (const checkpoint of guideline.checkpoints ?? []) {
      for (const rule of checkpoint.rules ?? []) {
        const criteria = criteriaByRule.get(rule.id) ?? new Set<string>();
        criteria.add(checkpoint.num);
        criteriaByRule.set(rule.id, criteria);
      }
    }

    const report = await checker.check(document, [rulesetId]);
    const criteria = new Map<string, {
      criterion: string;
      outcome: 'passed' | 'failed' | 'needs-review';
      source: string;
    }>();
    const priority = { passed: 0, 'needs-review': 1, failed: 2 } as const;
    for (const issue of report.results) {
      const confidence = issue.value?.[1] ?? 'MANUAL';
      const outcome = confidence === 'PASS'
        ? 'passed'
        : confidence === 'FAIL'
          ? 'failed'
          : 'needs-review';
      for (const criterion of criteriaByRule.get(issue.ruleId) ?? []) {
        const source = `ibm.${issue.ruleId}`;
        const key = `${source}\u0000${criterion}`;
        const existing = criteria.get(key);
        if (!existing || priority[outcome] > priority[existing.outcome]) {
          criteria.set(key, { criterion, outcome, source });
        }
      }
    }

    return {
      issues: report.results
        .filter((issue) => issue.value?.[1] !== 'PASS')
        .map((issue) => ({
          ruleId: issue.ruleId,
          ...(issue.reasonId !== undefined ? { reasonId: String(issue.reasonId) } : {}),
          policy: issue.value?.[0] ?? 'INFORMATION',
          confidence: issue.value?.[1] ?? 'MANUAL',
          message: issue.message ?? `IBM Equal Access rule ${issue.ruleId}`,
          selector: selectorFor(issue.node) ?? issue.path?.dom,
          criteria: [...(criteriaByRule.get(issue.ruleId) ?? [])].sort(),
        })),
      criteria: [...criteria.values()],
      numExecuted: report.numExecuted,
      ruleTime: report.ruleTime,
      rulesetName: guideline.name,
    };

    function selectorFor(node: Node | undefined): string | undefined {
      if (!(node instanceof Element)) return undefined;
      if (node.id) return `#${CSS.escape(node.id)}`;
      const parts: string[] = [];
      let current: Element | null = node;
      while (current && current !== document.documentElement) {
        let part = current.localName;
        const siblings = current.parentElement
          ? [...current.parentElement.children].filter(({ localName }) => localName === current!.localName)
          : [];
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        parts.unshift(part);
        current = current.parentElement;
      }
      return ['html', ...parts].join(' > ');
    }
  }, IBM_RULESET_ID);
}

function normalizeIbmIssues(issues: IbmRawIssue[]): NormalizedFinding[] {
  const groups = new Map<string, IbmRawIssue[]>();
  for (const issue of issues) {
    const manualReview = issue.confidence !== 'FAIL';
    const key = `${manualReview ? 'manual-review' : 'violation'}\u0000${issue.ruleId}`;
    const group = groups.get(key) ?? [];
    group.push(issue);
    groups.set(key, group);
  }

  return [...groups.entries()].map(([key, groupedIssues]) => {
    const [kind, ruleId] = key.split('\u0000');
    const manualReview = kind === 'manual-review';
    const translated = IBM_MESSAGES[ruleId];
    const count = groupedIssues.length;
    const prefix = translated?.(count) ??
      `IBM Equal Access meldet einen Befund zur Regel „${ruleId}“: ${count} betroffene${count === 1 ? 's Element' : ' Elemente'}.`;
    const message = manualReview
      ? `${prefix.replace(/\.$/u, '')} – manuell prüfen.`
      : prefix;
    return normalizedFinding({
      engine: 'ibm',
      ruleId: `${kind}-${ruleId}`,
      severity: ibmSeverity(groupedIssues, manualReview),
      message,
      translationStatus: translated ? 'verified' : 'fallback',
      originalMessage: [...new Set(groupedIssues.map(({ message: original }) => original))]
        .slice(0, 3)
        .join(' | '),
      wcagCriteria: [...new Set(groupedIssues.flatMap(({ criteria }) => criteria))].sort(),
      helpUrl: `${IBM_HELP_URL}#${encodeURIComponent(ruleId)}`,
      selectors: [...new Set(groupedIssues.map(({ selector }) => selector).filter(
        (selector): selector is string => Boolean(selector),
      ))].slice(0, 5),
      occurrenceCount: count,
    });
  });
}

function ibmSeverity(issues: IbmRawIssue[], manualReview: boolean): FindingSeverity {
  if (manualReview) return 'warning';
  if (issues.some(({ policy }) => policy === 'VIOLATION')) return 'critical';
  if (issues.some(({ policy }) => policy === 'RECOMMENDATION')) return 'warning';
  return 'info';
}
