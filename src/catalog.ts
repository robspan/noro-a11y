import type { FindingSeverity, NormalizedFinding } from './types.ts';

export const HTML_VALIDATE_MESSAGES: Readonly<Record<string, string>> = {
  'area-alt': 'Verlinkte Bildbereiche benötigen einen Alternativtext.',
  'aria-hidden-body': 'Der Dokumentinhalt darf nicht vollständig vor assistiver Technik verborgen werden.',
  'aria-label-misuse': 'ARIA-Beschriftungen werden an diesem Element nicht korrekt verwendet.',
  'attribute-allowed-values': 'Ein HTML-Attribut enthält einen nicht erlaubten Wert.',
  'attribute-misuse': 'Ein HTML-Attribut wird in einem unzulässigen Kontext verwendet.',
  'element-required-attributes': 'Bei einem HTML-Element fehlt ein erforderliches Attribut.',
  'empty-heading': 'Eine Überschrift besitzt keinen zugänglichen Inhalt.',
  'empty-title': 'Der Dokumenttitel ist leer.',
  'heading-level': 'Die Überschriftenhierarchie überspringt eine Ebene oder beginnt nicht sinnvoll.',
  'hidden-focusable': 'Ein fokussierbares Element ist vor assistiver Technik verborgen.',
  'input-missing-label': 'Ein Formularfeld besitzt keine programmatisch zugeordnete Beschriftung.',
  'multiple-labeled-controls': 'Eine Beschriftung ist mehreren Formularfeldern zugeordnet.',
  'no-abstract-role': 'Eine abstrakte ARIA-Rolle darf nicht direkt verwendet werden.',
  'no-autoplay': 'Medien dürfen nicht ohne geeignete Steuerungsmöglichkeit automatisch starten.',
  'no-dup-id': 'Eine ID kommt im Dokument mehrfach vor.',
  'no-implicit-button-type': 'Eine Schaltfläche benötigt einen expliziten Typ.',
  'no-missing-references': 'Eine HTML- oder ARIA-Referenz verweist auf kein vorhandenes Element.',
  'no-multiple-main': 'Das Dokument darf nur einen primären Hauptbereich besitzen.',
  'prefer-native-element': 'Für diese Funktion sollte ein passendes natives HTML-Element verwendet werden.',
  'unique-landmark': 'Mehrere gleichartige Orientierungspunkte benötigen eindeutige Namen.',
  'valid-autocomplete': 'Das autocomplete-Attribut enthält keinen gültigen Wert.',
  'valid-for': 'Eine Beschriftung verweist nicht auf ein beschriftbares Formularfeld.',
  'wcag/h30': 'Ein Link benötigt einen verständlichen zugänglichen Namen.',
  'wcag/h32': 'Ein Formular benötigt eine eindeutige Absende-Schaltfläche.',
  'wcag/h36': 'Eine grafische Absende-Schaltfläche benötigt einen Alternativtext.',
  'wcag/h37': 'Ein Bild benötigt ein alt-Attribut.',
  'wcag/h63': 'Tabellenüberschriften müssen ihren Datenzellen korrekt zugeordnet sein.',
  'wcag/h67': 'Dekorative Bilder benötigen einen leeren Alternativtext und dürfen keinen Titel tragen.',
  'wcag/h71': 'Zusammengehörige Formularfelder benötigen eine programmatisch erkennbare Gruppenbeschriftung.',
};

export const HTML_VALIDATE_RULES: Readonly<Record<string, 2>> = Object.fromEntries(
  Object.keys(HTML_VALIDATE_MESSAGES).map((rule) => [rule, 2 as const]),
);

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
    ...(input.location ? { location: input.location } : {}),
  };
}
