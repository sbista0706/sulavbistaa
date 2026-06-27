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

export interface ReportData {
  file_name: string;
  property_name: string | null;
  property_subtype: string | null;
  property_type: string | null;
  location: string | null;
  created_at: string;
  recommendation: Recommendation | null;
  metrics: MetricBag | null;
  type_metrics: MetricBag | null;
  risk_results: { rules: RiskRuleResult[]; decision: { reason: string } } | null;
  verify_items: { field: string; reason: string }[] | null;
}

const REC_LABEL: Record<Recommendation, string> = {
  pursue: "PURSUE",
  pursue_with_conditions: "PURSUE WITH CONDITIONS",
  pass: "PASS / EXCLUDED",
};

const REC_COLOR: Record<Recommendation, [number, number, number]> = {
  pursue: [21, 128, 61],
  pursue_with_conditions: [180, 83, 9],
  pass: [185, 28, 28],
};

const STATUS_LABEL: Record<RiskRuleResult["status"], string> = {
  pass: "PASS",
  high: "HIGH RISK",
  critical: "CRITICAL",
  review: "NEEDS REVIEW",
};

const STATUS_COLOR: Record<RiskRuleResult["status"], [number, number, number]> = {
  pass: [21, 128, 61],
  high: [180, 83, 9],
  critical: [185, 28, 28],
  review: [37, 99, 235],
};

function resolveFamily(row: ReportData): PropertyFamily | null {
  if (row.property_subtype && row.property_subtype in SUBTYPE_TO_FAMILY) {
    return SUBTYPE_TO_FAMILY[row.property_subtype as PropertySubtype];
  }
  if (row.property_type && row.property_type in FAMILY_LABELS) {
    return row.property_type as PropertyFamily;
  }
  return null;
}

export function generateReportPdf(data: ReportData): void {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentW = pageW - margin * 2;
  let y = margin;

  const ensure = (need: number) => {
    if (y + need > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const text = (
    s: string,
    opts: { size?: number; bold?: boolean; color?: [number, number, number]; x?: number; maxW?: number } = {},
  ) => {
    const size = opts.size ?? 10;
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(size);
    const [r, g, b] = opts.color ?? [26, 26, 26];
    doc.setTextColor(r, g, b);
    const lines = doc.splitTextToSize(s, opts.maxW ?? contentW);
    const lineH = size * 1.35;
    ensure(lines.length * lineH);
    doc.text(lines, opts.x ?? margin, y);
    y += lines.length * lineH;
  };

  const hr = () => {
    ensure(12);
    doc.setDrawColor(220, 220, 220);
    doc.line(margin, y, pageW - margin, y);
    y += 10;
  };

  const space = (n: number) => {
    y += n;
  };

  // Header
  const title = data.property_name || data.file_name || "Property screening";
  text(title, { size: 20, bold: true });
  const subParts = [
    data.property_subtype && SUBTYPE_LABELS[data.property_subtype as PropertySubtype],
    data.location,
    new Date(data.created_at).toLocaleDateString(),
  ].filter(Boolean) as string[];
  if (subParts.length) text(subParts.join(" · "), { size: 9, color: [120, 120, 120] });
  text(`Source OM: ${data.file_name}`, { size: 9, color: [120, 120, 120] });
  space(6);
  hr();

  // Recommendation pill
  const rec = data.recommendation;
  if (rec) {
    const color = REC_COLOR[rec];
    text("RECOMMENDATION", { size: 8, color: [120, 120, 120], bold: true });
    text(REC_LABEL[rec], { size: 22, bold: true, color });
    const reason = data.risk_results?.decision?.reason;
    if (reason) text(reason, { size: 10, color: [60, 60, 60] });
    space(8);
    hr();
  }

  // Key metrics
  const metrics = data.metrics ?? {};
  text("Key metrics", { size: 13, bold: true });
  space(4);
  UNIVERSAL_METRICS.forEach((d) => {
    const raw = metrics[d.key];
    const missing = raw === null || raw === undefined || raw === "";
    const val = missing ? "not found" : formatMetric(raw, d.unit);
    ensure(14);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    doc.text(d.label, margin, y);
    doc.setTextColor(missing ? 150 : 26, missing ? 150 : 26, missing ? 150 : 26);
    doc.setFont("helvetica", missing ? "italic" : "normal");
    doc.text(val, pageW - margin, y, { align: "right" });
    y += 14;
  });

  // Type metrics
  const family = resolveFamily(data);
  const typeMetrics = data.type_metrics ?? {};
  if (family && TYPE_METRICS[family].length > 0) {
    space(10);
    text(`${FAMILY_LABELS[family]} metrics`, { size: 13, bold: true });
    space(4);
    TYPE_METRICS[family].forEach((d) => {
      const raw = typeMetrics[d.key];
      const missing = raw === null || raw === undefined || raw === "";
      const val = missing ? "not found" : formatMetric(raw, d.unit);
      ensure(14);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(80, 80, 80);
      doc.text(d.label, margin, y);
      doc.setTextColor(missing ? 150 : 26, missing ? 150 : 26, missing ? 150 : 26);
      doc.setFont("helvetica", missing ? "italic" : "normal");
      doc.text(val, pageW - margin, y, { align: "right" });
      y += 14;
    });
  }

  // Risk screen
  const rules = data.risk_results?.rules ?? [];
  space(12);
  hr();
  text("Risk screen", { size: 13, bold: true });
  space(4);
  if (rules.length === 0) {
    text("No risk rules recorded.", { size: 10, color: [120, 120, 120] });
  }
  rules.forEach((r) => {
    ensure(46);
    const blockTop = y;
    const [sr, sg, sb] = STATUS_COLOR[r.status];
    // Status pill
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(26, 26, 26);
    doc.text(r.label, margin, y + 2);
    const pillLabel = STATUS_LABEL[r.status];
    doc.setFontSize(8);
    doc.setTextColor(sr, sg, sb);
    doc.text(pillLabel, pageW - margin, y + 2, { align: "right" });
    y += 14;
    if (r.value !== null && r.value !== undefined) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(60, 60, 60);
      doc.text(`Value: ${r.value}`, margin, y);
      y += 12;
    }
    if (r.threshold) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(120, 120, 120);
      doc.text(`Threshold: ${r.threshold}`, margin, y);
      y += 12;
    }
    if (r.note) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(60, 60, 60);
      const lines = doc.splitTextToSize(r.note, contentW);
      doc.text(lines, margin, y);
      y += lines.length * 11;
    }
    // left accent bar
    doc.setDrawColor(sr, sg, sb);
    doc.setLineWidth(2);
    doc.line(margin - 8, blockTop - 4, margin - 8, y - 2);
    doc.setLineWidth(0.5);
    y += 8;
  });

  // Items to verify
  const verify = data.verify_items ?? [];
  if (verify.length) {
    space(6);
    hr();
    text("Items to verify", { size: 13, bold: true });
    space(2);
    verify.forEach((v) => {
      text(`• ${v.field} — ${v.reason}`, { size: 10, color: [60, 60, 60] });
    });
  }

  // Footer on every page
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(
      `Ledger screening report · Generated ${new Date().toLocaleString()} · Page ${i} of ${pageCount}`,
      pageW / 2,
      pageH - 24,
      { align: "center" },
    );
    doc.text(
      "Verify all figures against the source OM. Not investment advice.",
      pageW / 2,
      pageH - 12,
      { align: "center" },
    );
  }

  const safeName = (data.property_name || data.file_name || "report")
    .replace(/\.pdf$/i, "")
    .replace(/[^a-z0-9-_ ]/gi, "_")
    .slice(0, 60);
  doc.save(`${safeName} — screening report.pdf`);
}
