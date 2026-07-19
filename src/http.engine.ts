import { normalizedFinding } from './catalog.ts';
import type { AccessibilityRunInput, AutomatedCriterionResult, EngineResult, NormalizedFinding } from './types.ts';

export async function runHttpEngine(input: AccessibilityRunInput): Promise<EngineResult> {
  const findings: NormalizedFinding[] = [];
  const criterionResults: AutomatedCriterionResult[] = [];
  const headers = input.http?.headers ?? {};
  const status = input.http?.status ?? 0;
  const contentType = headers['content-type'] ?? '';

  if (!contentType.toLowerCase().includes('text/html')) {
    findings.push(httpFinding('response-not-html', 'critical', 'Das Ziel hat kein HTML-Dokument ausgeliefert.'));
  }
  if (status >= 400) {
    findings.push(httpFinding('response-http-error', 'critical', `Das Ziel antwortet mit HTTP-Status ${status}.`));
  }
  if (!/<html\b[^>]*\blang\s*=\s*["'][^"']+["']/i.test(input.html)) {
    findings.push(httpFinding('html-missing-lang', 'critical', 'Am HTML-Element fehlt die Seitensprache.', ['3.1.1']));
    criterionResults.push(criterion('3.1.1', 'failed', 'http.html-lang'));
  } else {
    criterionResults.push(criterion('3.1.1', 'passed', 'http.html-lang'));
  }
  if (!/<title\b[^>]*>\s*[^<]+\s*<\/title>/i.test(input.html)) {
    findings.push(httpFinding('html-missing-title', 'critical', 'Das Dokument besitzt keinen aussagekräftigen Titel.', ['2.4.2']));
    criterionResults.push(criterion('2.4.2', 'failed', 'http.document-title'));
  } else {
    criterionResults.push(criterion('2.4.2', 'passed', 'http.document-title'));
  }
  if (!/<meta\b[^>]*\bname\s*=\s*["']viewport["'][^>]*>/i.test(input.html)) {
    findings.push(httpFinding('html-missing-viewport', 'warning', 'Es wurden keine Viewport-Angaben gefunden.'));
  }
  if (!/<h1\b[^>]*>.*?<\/h1>/is.test(input.html)) {
    findings.push(httpFinding('html-missing-h1', 'warning', 'Es wurde keine Überschrift der ersten Ebene gefunden.'));
  }

  const images = input.html.match(/<img\b[^>]*>/gi) ?? [];
  const missingAlt = images.filter((image) => !/\balt\s*=\s*(["']).*?\1/i.test(image)).length;
  if (missingAlt > 0) {
    findings.push(httpFinding(
      'html-images-without-alt',
      'critical',
      `${missingAlt} Bildelement${missingAlt === 1 ? '' : 'e'} ohne alt-Attribut gefunden.`,
      ['1.1.1'],
    ));
    criterionResults.push(criterion('1.1.1', 'failed', 'http.image-alt'));
  }

  for (const header of ['content-security-policy', 'x-content-type-options', 'referrer-policy']) {
    if (!headers[header]) {
      findings.push(httpFinding(`header-missing-${header}`, 'info', `Der HTTP-Header „${header}“ fehlt.`));
    }
  }

  return {
    engine: 'http',
    status: 'completed',
    summary: `Eine HTTP-Antwort geprüft; ${findings.length} Befunde erzeugt.`,
    findings,
    criterionResults,
    metadata: {
      httpStatus: status,
      contentType,
      bytesInspected: Buffer.byteLength(input.html),
      imagesInspected: images.length,
    },
    limitations: [
      'Diese Prüfung bewertet eine HTTP-Antwort mit deterministischen Heuristiken.',
      'Sie ersetzt weder die gerenderte Prüfung noch eine manuelle Abnahme.',
    ],
  };
}

function httpFinding(
  ruleId: string,
  severity: NormalizedFinding['severity'],
  message: string,
  wcagCriteria?: string[],
): NormalizedFinding {
  return normalizedFinding({ engine: 'http', ruleId, severity, message, wcagCriteria });
}

function criterion(
  value: string,
  outcome: AutomatedCriterionResult['outcome'],
  source: string,
): AutomatedCriterionResult {
  return { criterion: value, outcome, source };
}
