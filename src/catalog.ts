import type { FindingSeverity, NormalizedFinding } from './types.ts';

export function normalizedFinding(input: {
  engine: NormalizedFinding['engine'];
  ruleId: string;
  severity: FindingSeverity;
  message?: string;
  originalMessage?: string;
  translationStatus?: NormalizedFinding['translationStatus'];
  wcagCriteria?: string[];
  helpUrl?: string;
  selectors?: string[];
  occurrenceCount?: number;
  location?: NormalizedFinding['location'];
}): NormalizedFinding {
  const message = input.message ?? `Die Prüfengine meldet einen Befund zur Regel „${input.ruleId}“.`;
  return {
    code: `${input.engine}.${input.ruleId}`,
    engine: input.engine,
    ruleId: input.ruleId,
    severity: input.severity,
    message,
    translationStatus: input.translationStatus ?? (input.message ? 'verified' : 'fallback'),
    ...(input.originalMessage ? { originalMessage: input.originalMessage } : {}),
    ...(input.wcagCriteria?.length ? { wcagCriteria: input.wcagCriteria } : {}),
    ...(input.helpUrl ? { helpUrl: input.helpUrl } : {}),
    ...(input.selectors?.length ? { selectors: input.selectors } : {}),
    occurrenceCount: positiveOccurrenceCount(input.occurrenceCount),
    sources: [{
      engine: input.engine,
      ruleId: input.ruleId,
      code: `${input.engine}.${input.ruleId}`,
      occurrenceCount: positiveOccurrenceCount(input.occurrenceCount),
    }],
    ...(input.location ? { location: input.location } : {}),
  };
}

function positiveOccurrenceCount(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= 1
    ? Math.trunc(value)
    : 1;
}
