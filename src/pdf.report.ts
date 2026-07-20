import { chromium } from 'playwright';
import { renderHtmlReport } from './reports.ts';
import type { AccessibilityRunResult, ReportOptions } from './types.ts';

/**
 * Erzeugt aus dem semantischen HTML-Bericht ein getaggtes A4-PDF.
 * Chromium übernimmt Struktur-Tags, Dokumentgliederung und klickbare Links.
 */
export async function renderPdfReport(
  result: AccessibilityRunResult,
  options: ReportOptions = {},
): Promise<Uint8Array> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      const page = await context.newPage();
      await page.route('**/*', (route) => route.abort('blockedbyclient'));
      await page.setContent(renderHtmlReport(result, options), { waitUntil: 'load' });
      await page.locator('details').evaluateAll((elements) => {
        elements.forEach((element) => element.setAttribute('open', ''));
      });
      await page.emulateMedia({ media: 'print' });
      const pdf = await page.pdf({
        format: 'A4',
        preferCSSPageSize: true,
        printBackground: true,
        tagged: true,
        outline: true,
        displayHeaderFooter: false,
      });
      return new Uint8Array(pdf);
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
