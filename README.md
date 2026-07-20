# @spanier-one/barrierefreiheit

[![JSR](https://jsr.io/badges/@spanier-one/barrierefreiheit)](https://jsr.io/@spanier-one/barrierefreiheit)
[![Check](https://github.com/robspan/noro-a11y/actions/workflows/check.yml/badge.svg)](https://github.com/robspan/noro-a11y/actions/workflows/check.yml)
[![Lizenz: CC0-1.0](https://img.shields.io/badge/Lizenz-CC0--1.0-2454eb)](./LICENSE)

Typisierte Orchestrierung für wiederholbare Barrierefreiheitsprüfungen. Das
Paket führt ausgewählte Engines aus, normalisiert ihre Ergebnisse und liefert
öffentliche Befundtexte auf Deutsch. Ursprüngliche Toolmeldungen bleiben nur
als diagnostische Metadaten erhalten.

Veröffentlichung: ausschließlich über JSR als `jsr:@spanier-one/barrierefreiheit`. Die lokale
`package.json` ist als privat markiert und verhindert eine versehentliche
Veröffentlichung auf npm.

```ts
import { runAccessibilityChecks } from '@spanier-one/barrierefreiheit';

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
- `renderPdfReport`: versandfertiger PDF-Bericht im spanier.one-Erscheinungsbild

```ts
import { renderAgentReport, renderPdfReport, renderSarifReport } from '@spanier-one/barrierefreiheit';

const agentTasks = renderAgentReport(result);
const sarif = renderSarifReport(result);
const pdf = await renderPdfReport(result, { preparedFor: 'Beispiel GmbH' });
```

## Prüf-Engines

- `axe`: WCAG-orientierte DOM-Prüfungen mit der deutschen Sprache von axe-core
- `html-validate`: deterministische Regeln für HTML-Struktur und Barrierefreiheit
- `http`: spanier.one-Prüfungen für die HTML-Antwort und das rohe HTML-Dokument

`all` führt alle Engines aus `ENGINE_IDS` aus. Unbekannte Engine-Namen werden
mit einem Fehler abgelehnt, nicht stillschweigend ignoriert.

## Installation über JSR

```sh
deno add jsr:@spanier-one/barrierefreiheit
```

Node-Projekte können JSR über einen kompatiblen Paketmanager verwenden:

```sh
pnpm add jsr:@spanier-one/barrierefreiheit
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
