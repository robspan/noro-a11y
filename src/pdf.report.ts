import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import type { AccessibilityRunResult, NormalizedFinding, ReportOptions } from './types.ts';

const PAGE = { width: 595.28, height: 841.89, margin: 48 };
const COLOR = {
  navy: rgb(11 / 255, 18 / 255, 36 / 255),
  blue: rgb(36 / 255, 84 / 255, 235 / 255),
  lime: rgb(210 / 255, 1, 58 / 255),
  grey: rgb(93 / 255, 102 / 255, 128 / 255),
  line: rgb(225 / 255, 229 / 255, 240 / 255),
  pale: rgb(244 / 255, 246 / 255, 1),
  white: rgb(1, 1, 1),
};

/** Erzeugt einen eigenständigen PDF-Bericht im spanier.one-Erscheinungsbild. */
export async function renderPdfReport(
  result: AccessibilityRunResult,
  options: ReportOptions = {},
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const context = { pdf, regular, bold, page: newPage(pdf, bold), y: 700, pageNumber: 1 };

  drawTitle(context.page, bold, regular, result, options);
  context.y = 530;
  drawSummary(context.page, bold, regular, result);
  context.y = 430;

  const sorted = [...result.findings].sort((a, b) => severityOrder(a) - severityOrder(b));
  for (const finding of sorted) drawFinding(context, finding);
  drawNotice(context, 'Automatische Prüfungen allein weisen keine rechtliche Konformität nach.');

  const pages = pdf.getPages();
  pages.forEach((page, index) => drawFooter(page, regular, index + 1, pages.length));
  pdf.setTitle(options.title ?? `spanier.one Prüfbericht - ${result.url}`);
  pdf.setAuthor('spanier.one');
  pdf.setSubject('Automatischer Bericht zur digitalen Barrierefreiheit');
  pdf.setKeywords(['Barrierefreiheit', 'WCAG', 'BFSG', 'spanier.one']);
  return pdf.save();
}

interface PdfContext {
  pdf: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
  page: PDFPage;
  y: number;
  pageNumber: number;
}

function newPage(pdf: PDFDocument, bold: PDFFont): PDFPage {
  const page = pdf.addPage([PAGE.width, PAGE.height]);
  page.drawRectangle({ x: 0, y: 0, width: PAGE.width, height: PAGE.height, color: COLOR.white });
  page.drawRectangle({ x: 0, y: PAGE.height - 16, width: PAGE.width, height: 16, color: COLOR.blue });
  page.drawText('spanier.one', { x: PAGE.margin, y: PAGE.height - 58, font: bold, size: 24, color: COLOR.navy });
  page.drawCircle({ x: 181, y: PAGE.height - 48, size: 7, color: COLOR.lime });
  return page;
}

function drawTitle(page: PDFPage, bold: PDFFont, regular: PDFFont, result: AccessibilityRunResult, options: ReportOptions): void {
  page.drawText('AUTOMATISCHE BESTANDSAUFNAHME', { x: PAGE.margin, y: 740, font: bold, size: 9, color: COLOR.blue });
  page.drawText(options.title ?? 'Barrierefreiheitsbericht', { x: PAGE.margin, y: 688, font: bold, size: 36, color: COLOR.navy });
  drawWrapped(page, result.url, PAGE.margin, 654, PAGE.width - PAGE.margin * 2, regular, 13, COLOR.grey, 18);
  if (options.preparedFor) page.drawText(`Erstellt für: ${options.preparedFor}`, { x: PAGE.margin, y: 616, font: regular, size: 10, color: COLOR.grey });
}

function drawSummary(page: PDFPage, bold: PDFFont, regular: PDFFont, result: AccessibilityRunResult): void {
  const values = [
    [String(result.findings.length), 'Befunde'],
    [String(result.requestedEngines.length), 'Engines'],
    [String(result.findings.filter((finding) => finding.severity === 'critical').length), 'Kritisch'],
  ];
  values.forEach(([value, label], index) => {
    const x = PAGE.margin + index * 166;
    page.drawRectangle({ x, y: 530, width: 152, height: 72, color: COLOR.pale });
    page.drawText(value, { x: x + 16, y: 563, font: bold, size: 25, color: COLOR.navy });
    page.drawText(label, { x: x + 16, y: 544, font: regular, size: 9, color: COLOR.grey });
  });
}

function drawFinding(context: PdfContext, finding: NormalizedFinding): void {
  const messageLines = wrapText(finding.message, context.bold, 13, PAGE.width - PAGE.margin * 2 - 30);
  const selector = finding.selectors?.join(', ') || 'Seitenweit';
  const detail = `${finding.engine}/${finding.ruleId} · WCAG ${finding.wcagCriteria?.join(', ') || 'nicht zugeordnet'} · ${selector}`;
  const detailLines = wrapText(detail, context.regular, 8.5, PAGE.width - PAGE.margin * 2 - 30);
  const height = 56 + messageLines.length * 17 + detailLines.length * 12;
  ensureSpace(context, height + 14);
  const yBottom = context.y - height;
  context.page.drawRectangle({ x: PAGE.margin, y: yBottom, width: PAGE.width - PAGE.margin * 2, height, color: COLOR.pale });
  context.page.drawRectangle({ x: PAGE.margin, y: yBottom, width: 4, height, color: severityColor(finding) });
  context.page.drawText(severityLabel(finding), { x: PAGE.margin + 18, y: context.y - 22, font: context.bold, size: 8, color: severityColor(finding) });
  let lineY = context.y - 45;
  for (const line of messageLines) {
    context.page.drawText(line, { x: PAGE.margin + 18, y: lineY, font: context.bold, size: 13, color: COLOR.navy });
    lineY -= 17;
  }
  lineY -= 4;
  for (const line of detailLines) {
    context.page.drawText(line, { x: PAGE.margin + 18, y: lineY, font: context.regular, size: 8.5, color: COLOR.grey });
    lineY -= 12;
  }
  context.y = yBottom - 14;
}

function drawNotice(context: PdfContext, text: string): void {
  ensureSpace(context, 62);
  context.page.drawRectangle({ x: PAGE.margin, y: context.y - 52, width: PAGE.width - PAGE.margin * 2, height: 52, color: COLOR.navy });
  drawWrapped(context.page, text, PAGE.margin + 16, context.y - 22, PAGE.width - PAGE.margin * 2 - 32, context.regular, 9.5, COLOR.white, 13);
  context.y -= 66;
}

function ensureSpace(context: PdfContext, required: number): void {
  if (context.y - required >= 72) return;
  context.page = newPage(context.pdf, context.bold);
  context.pageNumber += 1;
  context.page.drawText('BEFUNDE · FORTSETZUNG', { x: PAGE.margin, y: 740, font: context.bold, size: 9, color: COLOR.blue });
  context.y = 710;
}

function drawFooter(page: PDFPage, font: PDFFont, current: number, total: number): void {
  page.drawLine({ start: { x: PAGE.margin, y: 48 }, end: { x: PAGE.width - PAGE.margin, y: 48 }, thickness: 1, color: COLOR.line });
  page.drawText('@spanier-one/barrierefreiheit · JSR', { x: PAGE.margin, y: 28, font, size: 8, color: COLOR.grey });
  page.drawText(`${current} / ${total}`, { x: PAGE.width - PAGE.margin - 22, y: 28, font, size: 8, color: COLOR.grey });
}

function drawWrapped(page: PDFPage, text: string, x: number, y: number, width: number, font: PDFFont, size: number, color: ReturnType<typeof rgb>, lineHeight: number): void {
  wrapText(text, font, size, width).forEach((line, index) => page.drawText(line, { x, y: y - index * lineHeight, font, size, color }));
}

function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width || !line) line = candidate;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

function severityOrder(finding: NormalizedFinding): number {
  return finding.severity === 'critical' ? 0 : finding.severity === 'warning' ? 1 : 2;
}

function severityLabel(finding: NormalizedFinding): string {
  return finding.severity === 'critical' ? 'KRITISCH' : finding.severity === 'warning' ? 'WARNUNG' : 'HINWEIS';
}

function severityColor(finding: NormalizedFinding): ReturnType<typeof rgb> {
  return finding.severity === 'critical' ? rgb(239 / 255, 71 / 255, 111 / 255) : finding.severity === 'warning' ? rgb(1, 183 / 255, 3 / 255) : COLOR.blue;
}
