import { runAxeEngine } from './axe.engine.ts';
import { runHtmlValidateEngine } from './html-validate.engine.ts';
import { runHttpEngine } from './http.engine.ts';
import { ENGINE_IDS } from './types.ts';
import type {
  AccessibilityRunInput,
  AccessibilityRunOptions,
  AccessibilityRunResult,
  EngineId,
  EngineSelection,
} from './types.ts';

const RUNNERS = {
  http: runHttpEngine,
  'html-validate': runHtmlValidateEngine,
  axe: runAxeEngine,
} satisfies Record<EngineId, (input: AccessibilityRunInput) => Promise<AccessibilityRunResult['results'][number]>>;

/** Führt die gewählten Prüf-Engines aus und vereinheitlicht ihre Befunde auf Deutsch. */
export async function runAccessibilityChecks(
  input: AccessibilityRunInput,
  options: AccessibilityRunOptions = {},
): Promise<AccessibilityRunResult> {
  const requestedEngines = resolveEngines(options.engines ?? 'all');
  const startedAt = new Date().toISOString();
  const results = await Promise.all(requestedEngines.map((engine) => RUNNERS[engine](input)));
  return {
    url: input.url,
    locale: 'de',
    requestedEngines,
    startedAt,
    completedAt: new Date().toISOString(),
    results,
    findings: results.flatMap((result) => result.findings),
  };
}

/** Löst `all`, eine einzelne Engine oder eine Engine-Liste deterministisch auf. */
export function resolveEngines(selection: EngineSelection): EngineId[] {
  const requested = selection === 'all'
    ? [...ENGINE_IDS]
    : typeof selection === 'string'
      ? [selection]
      : [...selection];
  const unique = [...new Set(requested)];
  for (const engine of unique) {
    if (!ENGINE_IDS.includes(engine)) throw new Error(`Unbekannte Prüfengine: ${String(engine)}`);
  }
  if (unique.length === 0) throw new Error('Mindestens eine Prüfengine muss ausgewählt werden.');
  return unique;
}
