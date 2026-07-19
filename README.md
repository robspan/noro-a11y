# @noro/barrierefreiheit

Typisierte Orchestrierung für wiederholbare Barrierefreiheitsprüfungen. Das
Paket führt ausgewählte Engines aus, normalisiert ihre Ergebnisse und liefert
öffentliche Befundtexte auf Deutsch. Ursprüngliche Toolmeldungen bleiben nur
als diagnostische Metadaten erhalten.

Veröffentlichung: ausschließlich über JSR als `jsr:@noro/barrierefreiheit`. Die lokale
`package.json` ist als privat markiert und verhindert eine versehentliche
Veröffentlichung auf npm.

```ts
import { runAccessibilityChecks } from '@noro/barrierefreiheit';

const result = await runAccessibilityChecks(
  {
    url: 'https://example.org',
    html,
    http: { status: 200, headers },
    page,
  },
  { engines: 'all' },
);
```

Nur bestimmte Prüfungen ausführen:

```ts
await runAccessibilityChecks(input, {
  engines: ['axe', 'html-validate'],
});
```

## Ausgabeformate

- `renderJsonReport`: vollständiges typisiertes Prüfergebnis
- `renderSarifReport`: SARIF 2.1.0 für CI und Code Scanning
- `renderMarkdownReport`: lesbarer Bericht für Tickets und Dokumentation
- `renderHtmlReport`: eigenständiger, responsiver HTML-Bericht
- `renderAgentReport`: priorisierte Aufgaben und Abnahmekriterien für Coding Agents
- `renderPdfReport`: versandfertiger PDF-Bericht im Noro-Erscheinungsbild

```ts
import { renderAgentReport, renderPdfReport, renderSarifReport } from '@noro/barrierefreiheit';

const agentTasks = renderAgentReport(result);
const sarif = renderSarifReport(result);
const pdf = await renderPdfReport(result, { preparedFor: 'Beispiel GmbH' });
```

## Prüf-Engines

- `axe`: WCAG-orientierte DOM-Prüfungen mit der deutschen Sprache von axe-core
- `html-validate`: deterministische Regeln für HTML-Struktur und Barrierefreiheit
- `http`: Noro-Prüfungen für HTTP-Header und das rohe HTML-Dokument

`all` führt alle Engines aus `ENGINE_IDS` aus. Unbekannte Engine-Namen werden
mit einem Fehler abgelehnt, nicht stillschweigend ignoriert.

## Installation über JSR

```sh
deno add jsr:@noro/barrierefreiheit
```

Node-Projekte können JSR über einen kompatiblen Paketmanager verwenden:

```sh
pnpm add jsr:@noro/barrierefreiheit
```

## Übersetzungsprinzip

Befunde werden anhand stabiler Engine- und Regel-IDs normalisiert. Veränderliche
englische Sätze werden nicht als Übersetzungsschlüssel verwendet. Bekannte
Regeln erhalten geprüfte deutsche Texte. Für zukünftige unbekannte Regeln wird
ein deutscher Ersatztext ausgegeben; die Originalmeldung bleibt für die
Diagnose in `originalMessage` erhalten.

Automatische Prüfungen allein weisen keine Konformität mit WCAG, EN 301 549,
BFSG oder anderen rechtlichen Anforderungen nach.

## Lizenz

Der ursprüngliche Wrapper-Code steht unter CC0-1.0. Abhängigkeiten und deren
Sprachdaten behalten die in `THIRD_PARTY_NOTICES.md` genannten Lizenzen.
