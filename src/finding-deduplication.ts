import type {
  FindingSeverity,
  FindingSource,
  NormalizedFinding,
  TranslationStatus,
} from './types.ts';

interface FindingFamily {
  key: string;
  matches: (code: string) => boolean;
  message: (count: number) => string;
}

const FINDING_FAMILIES: FindingFamily[] = [
  {
    key: 'image-alt',
    matches: (code) => code === 'axe.violation-image-alt',
    message: (count) =>
      `${count} Bildelement${count === 1 ? '' : 'e'} ohne geeigneten Alternativtext gefunden.`,
  },
  {
    key: 'page-language',
    matches: (code) => code === 'axe.violation-html-has-lang',
    message: () => 'Am HTML-Element fehlt eine gültige Seitensprache.',
  },
  {
    key: 'document-title',
    matches: (code) => code === 'axe.violation-document-title',
    message: () => 'Das Dokument besitzt keinen aussagekräftigen Titel.',
  },
  {
    key: 'form-label',
    matches: (code) => code === 'axe.violation-label',
    message: (count) =>
      `${count} Formularfeld${count === 1 ? ' besitzt' : 'er besitzen'} keine programmatisch zugeordnete Beschriftung.`,
  },
  {
    key: 'hidden-focusable',
    matches: (code) => code === 'axe.violation-aria-hidden-focus',
    message: (count) =>
      `${count} fokussierbare${count === 1 ? 's Element ist' : ' Elemente sind'} vor assistiver Technik verborgen.`,
  },
  {
    key: 'unique-landmark',
    matches: (code) => code === 'axe.violation-landmark-unique',
    message: () => 'Mehrere gleichartige Orientierungspunkte benötigen eindeutige Namen.',
  },
  {
    key: 'link-name',
    matches: (code) => code === 'axe.violation-link-name',
    message: (count) =>
      `${count} Link${count === 1 ? ' benötigt' : 's benötigen'} einen verständlichen zugänglichen Namen.`,
  },
];

interface MutableFinding {
  representative: NormalizedFinding;
  criteria: Set<string>;
  selectors: Set<string>;
  sources: Map<string, FindingSource>;
  family?: FindingFamily;
}

export interface FindingDeduplicationOptions {
  /**
   * `sum` aggregiert einzelne Meldungen einer Engine innerhalb eines Laufs.
   * `max` führt bereits aggregierte Ergebnisse mehrerer UI-Zustände zusammen.
   */
  sourceAggregation?: 'sum' | 'max';
}

/**
 * Führt gleichwertige Meldungen mehrerer Engines zusammen. Die Engine-Ergebnisse
 * selbst bleiben unverändert; nur die berichtsfähige Top-Level-Liste wird
 * dedupliziert und enthält vollständige Quellenprovenienz.
 */
export function deduplicateFindings(
  findings: readonly NormalizedFinding[],
  options: FindingDeduplicationOptions = {},
): NormalizedFinding[] {
  const groups = new Map<string, MutableFinding>();

  for (const finding of findings) {
    addFinding(groups, finding, options.sourceAggregation ?? 'sum');
  }

  return [...groups.values()]
    .map(finalizeFinding)
    .sort((a, b) =>
      severityRank(a.severity) - severityRank(b.severity) ||
      a.code.localeCompare(b.code),
    );
}

function addFinding(
  groups: Map<string, MutableFinding>,
  finding: NormalizedFinding,
  aggregation: 'sum' | 'max',
): void {
  const family = FINDING_FAMILIES.find(({ matches }) => matches(finding.code));
  const key = family ? `family:${family.key}` : `code:${finding.code}`;
  const group = groups.get(key) ?? createFindingGroup(finding, family);
  if (isBetterRepresentative(finding, group.representative)) {
    group.representative = finding;
  }
  addValues(group.criteria, finding.wcagCriteria);
  addValues(group.selectors, finding.selectors);
  addSources(group.sources, finding, aggregation);
  groups.set(key, group);
}

function createFindingGroup(
  finding: NormalizedFinding,
  family: FindingFamily | undefined,
): MutableFinding {
  return {
    representative: finding,
    criteria: new Set<string>(),
    selectors: new Set<string>(),
    sources: new Map<string, FindingSource>(),
    family,
  };
}

function addValues(
  target: Set<string>,
  values: readonly string[] | undefined,
): void {
  for (const value of values ?? []) target.add(value);
}

function addSources(
  target: Map<string, FindingSource>,
  finding: NormalizedFinding,
  aggregation: 'sum' | 'max',
): void {
  const sources = finding.sources?.length ? finding.sources : [sourceFor(finding)];
  for (const source of sources) {
    const key = `${source.engine}\u0000${source.ruleId}\u0000${source.code}`;
    const previous = target.get(key)?.occurrenceCount ?? 0;
    const next = positiveCount(source.occurrenceCount);
    target.set(key, {
      ...source,
      occurrenceCount: aggregateOccurrenceCount(previous, next, aggregation),
    });
  }
}

function aggregateOccurrenceCount(
  previous: number,
  next: number,
  aggregation: 'sum' | 'max',
): number {
  return aggregation === 'max' ? Math.max(previous, next) : previous + next;
}

function finalizeFinding(group: MutableFinding): NormalizedFinding {
  const sources = [...group.sources.values()].sort((a, b) =>
    a.engine.localeCompare(b.engine) ||
    a.ruleId.localeCompare(b.ruleId) ||
    a.code.localeCompare(b.code),
  );
  const occurrenceCount = Math.max(...sources.map(({ occurrenceCount }) => occurrenceCount));
  const representative = group.representative;
  return {
    ...representative,
    severity: sources.reduce(
      (severity, source) => {
        const findingSeverity = source.code === representative.code
          ? representative.severity
          : severityForSource(source, representative.severity);
        return severityRank(findingSeverity) < severityRank(severity) ? findingSeverity : severity;
      },
      representative.severity,
    ),
    message: group.family?.message(occurrenceCount) ?? representative.message,
    translationStatus: group.family ? 'verified' : representative.translationStatus,
    ...(group.criteria.size ? { wcagCriteria: [...group.criteria].sort() } : {}),
    ...(group.selectors.size ? { selectors: [...group.selectors].sort().slice(0, 10) } : {}),
    occurrenceCount,
    sources,
  };
}

function isBetterRepresentative(candidate: NormalizedFinding, current: NormalizedFinding): boolean {
  const severityDifference = severityRank(candidate.severity) - severityRank(current.severity);
  if (severityDifference !== 0) return severityDifference < 0;
  const translationDifference =
    translationRank(candidate.translationStatus) - translationRank(current.translationStatus);
  if (translationDifference !== 0) return translationDifference < 0;
  return candidate.code.localeCompare(current.code) < 0;
}

function sourceFor(finding: NormalizedFinding): FindingSource {
  return {
    engine: finding.engine,
    ruleId: finding.ruleId,
    code: finding.code,
    occurrenceCount: positiveCount(finding.occurrenceCount),
  };
}

function severityForSource(source: FindingSource, fallback: FindingSeverity): FindingSeverity {
  if (source.code.includes('manual-review')) return 'warning';
  return fallback;
}

function severityRank(severity: FindingSeverity): number {
  return severity === 'critical' ? 0 : severity === 'warning' ? 1 : 2;
}

function translationRank(status: TranslationStatus): number {
  return status === 'verified' ? 0 : status === 'engine-locale' ? 1 : 2;
}

function positiveCount(value: number): number {
  return Number.isFinite(value) && value >= 1 ? Math.trunc(value) : 1;
}
