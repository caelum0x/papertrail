// Renders a verification result as a complete, self-contained HTML document a
// researcher can open, read, and print to PDF for the "Download provenance report"
// button. Same ReportInput as the Markdown export (lib/reportExport.ts) — every
// quoted source span is the code-grounded verbatim substring (see lib/grounding.ts),
// and all dynamic text is HTML-escaped. Pure: no mutation, deterministic output.

import { ReportInput } from "./reportExport";

const DISCREPANCY_LABELS: Record<string, string> = {
  accurate: "Accurate",
  magnitude_overstated: "Magnitude overstated",
  population_overgeneralized: "Population overgeneralized",
  caveat_dropped: "Caveat dropped",
  no_support_found: "No support found",
};

function label(discrepancyType: string): string {
  return DISCREPANCY_LABELS[discrepancyType] ?? discrepancyType;
}

/** Escape the five XML/HTML-significant characters so dynamic text can never inject markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function registryName(sourceType: string): string {
  return sourceType === "pubmed" ? "PubMed" : "ClinicalTrials.gov";
}

function sourceCitationHtml(source: ReportInput["source"]): string {
  const registry = registryName(source.source_type);
  const id = source.external_id ? `${registry} ${source.external_id}` : registry;
  const title = source.title || source.url;
  const safeUrl = escapeHtml(source.url);
  return [
    `<p class="citation-title">${escapeHtml(title)}</p>`,
    `<p class="citation-meta">${escapeHtml(id)}</p>`,
    `<p class="citation-link"><a href="${safeUrl}">${safeUrl}</a></p>`,
  ].join("\n      ");
}

function flaggedSpanHtml(span: ReportInput["verification"]["flagged_spans"][number]): string {
  return [
    `<li class="flag">`,
    `  <p class="flag-claim"><span class="flag-label">Claim:</span> &ldquo;${escapeHtml(span.claim_span)}&rdquo;</p>`,
    `  <p class="flag-source"><span class="flag-label">Source says:</span> &ldquo;${escapeHtml(span.source_span)}&rdquo;</p>`,
    `  <p class="flag-issue"><span class="flag-label">Issue:</span> ${escapeHtml(span.issue)}</p>`,
    `</li>`,
  ].join("\n        ");
}

/**
 * Build a complete, standalone HTML provenance report. Sections: header, verdict +
 * trust score, the checked claim, the primary source citation (title + registry id +
 * link), the deterministic numeric check (if present and not "cannot_reconcile"), and
 * each flagged discrepancy with its verbatim source quote. Inline styles only; no
 * external assets, so it renders identically offline and prints cleanly to PDF.
 */
export function toHtmlReport(input: ReportInput): string {
  const { claim, source, verification, effectSizeCheck } = input;

  const numericCheck =
    effectSizeCheck && effectSizeCheck.verdict !== "cannot_reconcile"
      ? `<section class="block numeric">
        <h2>Numeric check &mdash; ${escapeHtml(label(effectSizeCheck.verdict))}</h2>
        <p>${escapeHtml(effectSizeCheck.rationale)}</p>
      </section>`
      : "";

  let flagsSection: string;
  if (verification.flagged_spans.length > 0) {
    const items = verification.flagged_spans.map(flaggedSpanHtml).join("\n        ");
    flagsSection = `<section class="block flags">
        <h2>Flagged discrepancies</h2>
        <ul>
        ${items}
        </ul>
      </section>`;
  } else if (verification.discrepancy_type === "accurate") {
    flagsSection = `<section class="block flags">
        <h2>Flagged discrepancies</h2>
        <p class="no-flags">No discrepancies flagged &mdash; the claim is consistent with the source.</p>
      </section>`;
  } else {
    flagsSection = "";
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PaperTrail verification report</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1a1a1a;
      line-height: 1.5;
      max-width: 720px;
      margin: 0 auto;
      padding: 40px 24px;
      background: #ffffff;
    }
    header { border-bottom: 2px solid #1a1a1a; padding-bottom: 12px; margin-bottom: 24px; }
    header h1 { font-size: 22px; margin: 0; }
    header p { margin: 4px 0 0; color: #555; font-size: 13px; }
    .verdict { display: flex; flex-wrap: wrap; gap: 16px; align-items: baseline; margin-bottom: 8px; }
    .verdict-label { font-size: 20px; font-weight: 700; }
    .trust-score { font-size: 15px; color: #333; }
    .explanation { margin: 0 0 24px; }
    .block { margin-bottom: 24px; }
    .block h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.04em; color: #555; margin: 0 0 8px; }
    blockquote.claim {
      margin: 0;
      padding: 12px 16px;
      border-left: 3px solid #888;
      background: #f6f6f6;
      font-style: italic;
    }
    .citation-title { font-weight: 600; margin: 0 0 2px; }
    .citation-meta { margin: 0 0 2px; color: #555; font-size: 13px; }
    .citation-link { margin: 0; font-size: 13px; word-break: break-all; }
    a { color: #0b5cad; }
    ul { list-style: none; padding: 0; margin: 0; }
    .flag { border: 1px solid #e0e0e0; border-radius: 6px; padding: 12px 16px; margin-bottom: 12px; }
    .flag p { margin: 0 0 4px; }
    .flag p:last-child { margin-bottom: 0; }
    .flag-label { font-weight: 600; }
    .no-flags { margin: 0; }
    footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e0e0e0; color: #777; font-size: 12px; }
    @media print {
      body { padding: 0; max-width: none; }
      a { color: #1a1a1a; }
      .flag { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <header>
    <h1>PaperTrail verification</h1>
    <p>Provenance report for a clinical-trial efficacy claim</p>
  </header>

  <section class="verdict">
    <span class="verdict-label">${escapeHtml(label(verification.discrepancy_type))}</span>
    <span class="trust-score">Trust score: ${escapeHtml(String(verification.trust_score))}/100</span>
  </section>
  <p class="explanation">${escapeHtml(verification.explanation)}</p>

  <section class="block claim-block">
    <h2>Claim checked</h2>
    <blockquote class="claim">${escapeHtml(claim.trim())}</blockquote>
  </section>

  <section class="block source-block">
    <h2>Primary source</h2>
      ${sourceCitationHtml(source)}
  </section>

  ${numericCheck}

  ${flagsSection}

  <footer>
    Generated by PaperTrail. Every source quote is a verbatim substring of the cited source.
  </footer>
</body>
</html>`;
}
