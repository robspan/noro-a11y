import { HtmlValidate } from 'html-validate';
import { HTML_VALIDATE_MESSAGES, HTML_VALIDATE_RULES, normalizedFinding } from './catalog.ts';
import type { AccessibilityRunInput, EngineResult, FindingSeverity } from './types.ts';

const validator = new HtmlValidate({ rules: HTML_VALIDATE_RULES });

export async function runHtmlValidateEngine(input: AccessibilityRunInput): Promise<EngineResult> {
  const report = await validator.validateString(input.html, input.url);
  const findings = report.results.flatMap((result) => result.messages.map((message) => {
    const ruleId = message.ruleId ?? 'unknown-rule';
    const translated = HTML_VALIDATE_MESSAGES[ruleId];
    return normalizedFinding({
      engine: 'html-validate',
      ruleId,
      severity: severity(message.severity),
      message: translated,
      originalMessage: message.message,
      location: { line: message.line, column: message.column },
    });
  }));

  return {
    engine: 'html-validate',
    status: 'completed',
    summary: `HTML-Struktur mit ${Object.keys(HTML_VALIDATE_RULES).length} Regeln geprüft; ${findings.length} Befunde erzeugt.`,
    findings,
    metadata: {
      configuredRules: Object.keys(HTML_VALIDATE_RULES).length,
      valid: report.valid,
    },
    limitations: [
      'Die Prüfung bewertet statisches HTML und keine vollständigen Nutzerinteraktionen.',
      'Ein fehlerfreies Ergebnis ist kein Nachweis vollständiger Barrierefreiheit.',
    ],
  };
}

function severity(value: number): FindingSeverity {
  return value >= 2 ? 'warning' : 'info';
}
