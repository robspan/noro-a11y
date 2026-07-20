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

## Verlinkte Seiten prüfen

`crawlAccessibilityChecks` folgt internen Links in Breite. Standardmäßig werden
mit `depth: 1` die Startseite und deren direkt verlinkte Seiten geprüft, begrenzt
auf insgesamt 10 Seiten. `depth: 0` prüft nur die Startseite. Externe
Hosts, Fragmentvarianten, Download-Links und Nicht-HTML-Antworten werden nicht
geprüft. `maxPages` setzt unabhängig von der Tiefe eine harte Obergrenze.

Das Paket lädt URLs nicht ungefragt selbst. Die Anwendung behält dadurch die
Kontrolle über SSRF-Schutz, Authentifizierung, Timeouts und Browser-Kontexte.

```ts
import { crawlAccessibilityChecks } from '@spanier-one/barrierefreiheit';

const crawl = await crawlAccessibilityChecks('https://example.org', {
  depth: 2,
  maxPages: 30,
  engines: ['http', 'html-validate'],
  loadPage: async (url) => {
    const response = await safeHttpClient.get(url);
    return {
      url: response.finalUrl,
      html: response.body,
      http: { status: response.status, headers: response.headers },
    };
  },
});
```

## Ausgabeformate

- `renderJsonReport`: vollständiges typisiertes Prüfergebnis
- `renderSarifReport`: SARIF 2.1.0 für CI und Code Scanning
- `renderMarkdownReport`: lesbarer Bericht für Tickets und Dokumentation
- `renderHtmlReport`: eigenständiger, responsiver HTML-Bericht
- `renderAgentReport`: priorisierte Aufgaben und Abnahmekriterien für Coding Agents
- `renderPdfReport`: getaggter, verlinkter PDF-Bericht im spanier.one-Erscheinungsbild
- `summarizeAutomatedRisk`: derselbe automatische Befundindex als typisiertes Objekt

```ts
import { renderAgentReport, renderPdfReport, renderSarifReport } from '@spanier-one/barrierefreiheit';

const agentTasks = renderAgentReport(result);
const sarif = renderSarifReport(result);
const pdf = await renderPdfReport(result, { preparedFor: 'Beispiel GmbH' });
```

### Berichtshierarchie und Befundindex

HTML, Markdown und PDF beginnen mit einer visuellen Einordnung und führen danach
in den vollständigen technischen Befund. Die Ausgaben verlinken erkennbar auf
spanier.one, bleiben aber ohne externe Assets eigenständig nutzbar.

Der **automatische Befundindex** liegt zwischen 0 und 100. Er verdichtet ausschließlich
die in diesem Lauf erzeugten Meldungen: kritisch = 20 Punkte, Warnung = 8 Punkte,
Hinweis = 2 Punkte. Eine fehlgeschlagene Engine ergänzt 15 Punkte, eine nicht
ausgeführte Engine 5 Punkte. Der Wert wird bei 100 gedeckelt.

Der Index ist ausdrücklich kein Accessibility-, WCAG- oder Konformitätsscore.
Auch ein Wert von 0 lässt alle nicht automatisierbaren Prüffragen offen. Die
Risikobänder werden in den visuellen Berichten deshalb immer mit Klartext,
Zahlen und nicht nur über Farbe vermittelt.

Das PDF wird aus demselben semantischen HTML mit Chromium erzeugt. Dadurch
bleiben Überschriften, Listen, Beschreibungslisten, Links und die natürliche
Lesereihenfolge als PDF-Struktur erhalten. Für die PDF-Ausgabe muss das zu
Playwright passende Chromium installiert sein, zum Beispiel mit
`npx playwright install chromium`.

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
