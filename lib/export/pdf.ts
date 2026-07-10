// Deterministic PDF export of an evidence report / GRADE Summary of Findings.
// Uses pdf-lib (MIT, pure JS — no headless browser, no native deps) and renders the
// SAME content as the text/HTML exports (lib/evidenceReportExport) by paginating the
// plain-text serialization, so all three export formats stay in lockstep. Pure: given
// the same report it produces the same document (no dates/randomness baked in).

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { evidenceReportToText } from "../evidenceReportExport";
import type { BuildEvidenceReportResult } from "../evidenceReport";

const PAGE_WIDTH = 595.28; // A4 in points
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const BODY_SIZE = 10;
const TITLE_SIZE = 16;
const LINE_GAP = 1.35;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

// Break one logical line into rendered lines that fit CONTENT_WIDTH at the given font.
function wrap(text: string, font: PDFFont, size: number): string[] {
  if (text.length === 0) return [""];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= CONTENT_WIDTH) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      // A single word longer than the line: hard-split it.
      if (font.widthOfTextAtSize(word, size) > CONTENT_WIDTH) {
        let chunk = "";
        for (const ch of word) {
          if (font.widthOfTextAtSize(chunk + ch, size) > CONTENT_WIDTH) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        current = chunk;
      } else {
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Render an evidence report to a PDF (A4). Returns the raw bytes. Handles both the
 * full and insufficient-evidence report shapes (evidenceReportToText does the shape
 * handling). Never throws on ordinary content.
 */
export async function evidenceReportToPdf(
  report: BuildEvidenceReportResult,
  claim: string
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("PaperTrail — Summary of Findings");
  doc.setCreator("PaperTrail");
  doc.setProducer("PaperTrail (pdf-lib)");

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const draw = (text: string, f: PDFFont, size: number): void => {
    const rendered = wrap(text, f, size);
    for (const line of rendered) {
      if (y < MARGIN + size) {
        page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = PAGE_HEIGHT - MARGIN;
      }
      page.drawText(line, { x: MARGIN, y, size, font: f, color: rgb(0.1, 0.1, 0.12) });
      y -= size * LINE_GAP;
    }
  };

  // Title + claim header.
  draw("PaperTrail — Summary of Findings", bold, TITLE_SIZE);
  y -= 6;
  draw(`Claim: ${claim}`, bold, BODY_SIZE);
  y -= 10;

  // Body: the canonical plain-text serialization, line by line (blank lines add space).
  const text = evidenceReportToText(report, claim);
  for (const rawLine of text.split("\n")) {
    if (rawLine.trim().length === 0) {
      y -= BODY_SIZE * 0.6;
      continue;
    }
    // A heading heuristic: short ALL-CAPS-ish lines render bold.
    const isHeading = /^[A-Z][A-Za-z0-9 /()'-]{0,60}$/.test(rawLine) && rawLine === rawLine.toUpperCase();
    draw(rawLine, isHeading ? bold : font, BODY_SIZE);
  }

  return doc.save();
}
