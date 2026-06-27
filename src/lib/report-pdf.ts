import { jsPDF } from "jspdf";
import {
  UNIVERSAL_METRICS,
  TYPE_METRICS,
  SUBTYPE_TO_FAMILY,
  SUBTYPE_LABELS,
  FAMILY_LABELS,
  type PropertyFamily,
  type PropertySubtype,
  type RiskRuleResult,
  type Recommendation,
} from "@/lib/screening/taxonomy";
import { formatMetric } from "@/lib/screening/format";

type MetricBag = Record<string, number | string | null>;

export interface ReportDeal {
  property_name: string | null;
  file_name: string;
  property_subtype: string | null;
  property_type: string | null;
  location: string | null;
  recommendation: Recommendation | null;
  metrics: MetricBag | null;
  type_metrics: MetricBag | null;
  risk_results: { rules: RiskRuleResult[]; decision: { reason: string } } | null;
  report_text: string | null;
}

const REC_LABEL: Record<Recommendation, string> = {
  pursue: "PURSUE",
  pursue_with_conditions: "PURSUE WITH CONDITIONS",
  pass: "EXCLUDED",
};
const REC_COLOR: Record<Recommendation, [number, number, number]> = {
  pursue: [21, 128, 61],
  pursue_with_conditions: [180, 83, 9],
  pass: [185, 28, 28],
};
const STATUS_COLOR: Record<string, [number, number, number]> = {
  pass: [21, 128, 61], high: [180, 83, 9], critical: [185, 28, 28], review: [37, 99, 235],
};

function familyOf(d: ReportDeal): PropertyFamily | null {
  if (d.property_subtype && d.property_subtype in SUBTYPE_TO_FAMILY) {
    return SUBTYPE_TO_FAMILY[d.property_subtype as PropertySubtype];
  }
  if (d.property_type && d.property_type in FAMILY_LABELS) return d.property_type as PropertyFamily;
  return null;
}

// Build and download a clean screening report PDF from the deal data — fully
// client-side, no server/PDF service needed.
export function generateReportPdf(deal: ReportDeal): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 48;
  let y = M;

  const ensure = (h: number) => {
    if (y + h > pageH - M) { doc.addPage(); y = M; }
  };
  const heading = (text: string) => {
    ensure(30); y += 8;
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(90);
    doc.text(text.toUpperCase(), M, y); y += 6;
    doc.setDrawColor(225); doc.line(M, y, pageW - M, y); y += 14;
    doc.setTextColor(25);
  };
  const kv = (label: string, value: string) => {
    ensure(16);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(110);
    doc.text(label, M, y);
    doc.setFont("helvetica", "bold"); doc.setTextColor(25);
    doc.text(value, pageW - M, y, { align: "right" });
    y += 16;
  };
  const para = (text: string, color = 50, size = 10) => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(size); doc.setTextColor(color);
    for (const ln of doc.splitTextToSize(text, pageW - 2 * M)) {
      ensure(14); doc.text(ln, M, y); y += 14;
    }
  };

  // Header
  const name = deal.property_name || deal.file_name || "Screening report";
  doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(20);
  ensure(26); doc.text(name, M, y); y += 22;

  const fam = familyOf(deal);
  const sub = deal.property_subtype && deal.property_subtype in SUBTYPE_LABELS
    ? SUBTYPE_LABELS[deal.property_subtype as PropertySubtype] : "";
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(120);
  ensure(14); doc.text([sub, deal.location].filter(Boolean).join("   ·   ") || " ", M, y); y += 20;

  // Recommendation
  if (deal.recommendation) {
    const [r, g, b] = REC_COLOR[deal.recommendation];
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(r, g, b);
    ensure(18); doc.text(`Recommendation:  ${REC_LABEL[deal.recommendation]}`, M, y); y += 16;
    if (deal.risk_results?.decision?.reason) para(deal.risk_results.decision.reason, 90);
  }

  // Key metrics
  const m = deal.metrics || {};
  if (UNIVERSAL_METRICS.some((d) => m[d.key] != null && m[d.key] !== "")) {
    heading("Key metrics");
    for (const def of UNIVERSAL_METRICS) {
      const v = m[def.key];
      if (v == null || v === "") continue;
      kv(def.label, formatMetric(v, def.unit));
    }
  }

  // Type metrics
  const tm = deal.type_metrics || {};
  if (fam && TYPE_METRICS[fam].some((d) => tm[d.key] != null && tm[d.key] !== "")) {
    heading(`${FAMILY_LABELS[fam]} metrics`);
    for (const def of TYPE_METRICS[fam]) {
      const v = tm[def.key];
      if (v == null || v === "") continue;
      kv(def.label, formatMetric(v, def.unit));
    }
  }

  // Risk screen
  const rules = deal.risk_results?.rules || [];
  if (rules.length) {
    heading("Risk screen");
    for (const ru of rules) {
      ensure(16);
      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(25);
      doc.text(ru.label, M, y);
      const [r, g, b] = STATUS_COLOR[ru.status] || [90, 90, 90];
      doc.setTextColor(r, g, b);
      doc.text(ru.status.toUpperCase(), pageW - M, y, { align: "right" });
      y += 14;
      const detail = [ru.threshold, ru.note].filter(Boolean).join("   ·   ");
      if (detail) para(detail, 120, 9);
    }
  }

  // Analyst memo (strip markdown)
  if (deal.report_text) {
    heading("Analyst memo");
    para(deal.report_text.replace(/^#{1,6}\s*/gm, "").replace(/\*\*/g, "").replace(/\*/g, ""), 45);
  }

  // Footer
  ensure(26); y += 10;
  para("Generated by Property Pulse Check. Verify all figures against the source OM. Not investment advice.", 150, 8);

  const safe = name.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 60);
  doc.save(`${safe || "ledger"}-screening.pdf`);
}
