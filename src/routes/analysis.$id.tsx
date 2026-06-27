import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAnalysesRealtime } from "@/hooks/use-analyses-realtime";
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
import { Markdown } from "@/components/markdown";
import { ArrowLeft, CheckCircle2, AlertTriangle, XCircle, HelpCircle, Loader2, FileText, RefreshCw, ClipboardList, Download } from "lucide-react";
import { generateReportPdf } from "@/lib/report-pdf";

export const Route = createFileRoute("/analysis/$id")({
  head: () => ({
    meta: [
      { title: "Risk results — Ledger" },
      { name: "description", content: "Risk-rule results, extracted metrics and recommendation for an uploaded OM." },
    ],
  }),
  component: AnalysisPage,
});

type MetricBag = Record<string, number | string | null>;

interface Row {
  id: string;
  file_name: string;
  property_name: string | null;
  property_type: string | null;
  property_subtype: string | null;
  type_detected_by: string | null;
  location: string | null;
  status: string;
  recommendation: Recommendation | null;
  metrics: MetricBag | null;
  type_metrics: MetricBag | null;
  risk_results: { rules: RiskRuleResult[]; decision: { reason: string } } | null;
  verify_items: { field: string; reason: string }[] | null;
  report_text: string | null;
  report_path: string | null;
  error_message: string | null;
  created_at: string;
}

const SUBTYPES = Object.keys(SUBTYPE_LABELS) as PropertySubtype[];

function resolveFamily(row: Row): PropertyFamily | null {
  if (row.property_subtype && row.property_subtype in SUBTYPE_TO_FAMILY) {
    return SUBTYPE_TO_FAMILY[row.property_subtype as PropertySubtype];
  }
  if (row.property_type && row.property_type in FAMILY_LABELS) {
    return row.property_type as PropertyFamily;
  }
  return null;
}

async function downloadReport(reportPath: string): Promise<void> {
  const { data, error } = await supabase.storage.from("reports").createSignedUrl(reportPath, 120);
  if (!error && data?.signedUrl) window.open(data.signedUrl, "_blank");
}

function AnalysisPage() {
  const { id } = Route.useParams();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["analysis", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("analyses").select("*").eq("id", id).single();
      if (error) throw error;
      return data as unknown as Row;
    },
  });

  useAnalysesRealtime(["analysis", id]);

  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-20 text-center text-muted-foreground">
        <Loader2 className="mx-auto h-6 w-6 animate-spin" />
        <p className="mt-3 text-sm">Loading…</p>
      </div>
    );
  }

  if (data.status === "pending" || data.status === "processing") {
    const queued = data.status === "pending";
    return (
      <div className="mx-auto max-w-3xl px-6 py-20 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
        <h1 className="font-display mt-6 text-3xl">{queued ? "Queued…" : "Analyzing OM…"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {queued
            ? "Waiting for the screening pipeline to pick this up. It updates here automatically."
            : "Detecting the property type, extracting metrics and running the risk screen. Updates live."}
        </p>
      </div>
    );
  }

  if (data.status === "failed") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <BackLink />
        <div className="card-base mt-6 p-8 text-center">
          <XCircle className="mx-auto h-10 w-10 text-destructive" />
          <h1 className="mt-4 text-xl font-semibold">Analysis failed</h1>
          <p className="mt-2 text-sm text-muted-foreground">{data.error_message ?? "Unknown error."}</p>
          <div className="mt-5 flex justify-center gap-2">
            <button onClick={() => refetch()} className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-secondary">
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            <Link to="/upload" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              Try another OM
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const family = resolveFamily(data);
  const metrics = data.metrics ?? {};
  const typeMetrics = data.type_metrics ?? {};
  const rules = data.risk_results?.rules ?? [];
  const decision = data.risk_results?.decision;
  const verifyItems = data.verify_items ?? [];
  const isExcluded = data.status === "excluded" || data.recommendation === "pass";

  const onChangeSubtype = async (subtype: PropertySubtype) => {
    await supabase
      .from("analyses")
      .update({
        property_subtype: subtype,
        property_type: SUBTYPE_TO_FAMILY[subtype],
        type_detected_by: "user",
      })
      .eq("id", id);
    refetch();
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <BackLink />

      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Risk results</p>
          <h1 className="font-display mt-2 text-4xl">{data.property_name || data.file_name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            <span className="truncate">{data.file_name}</span>
            {data.location && (<><span>·</span><span>{data.location}</span></>)}
            <span>·</span>
            <span>{new Date(data.created_at).toLocaleDateString()}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Type</label>
          <select
            value={(data.property_subtype as string) ?? ""}
            onChange={(e) => onChangeSubtype(e.target.value as PropertySubtype)}
            className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm"
          >
            <option value="" disabled>Set type…</option>
            {SUBTYPES.map((s) => (<option key={s} value={s}>{SUBTYPE_LABELS[s]}</option>))}
          </select>
          {data.type_detected_by === "ai" && data.property_subtype && (
            <span className="rounded-full bg-info/10 px-2 py-0.5 text-[10px] text-info">AI</span>
          )}
        </div>
      </div>

      <RecommendationBanner row={data} reason={decision?.reason ?? ""} excluded={isExcluded} />

      <HeroMetrics metrics={metrics} rules={rules} />

      <div className="mt-10 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="space-y-8">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Risk screen</h2>
            <div className="mt-3 space-y-3">
              {rules.length === 0 && <p className="text-sm text-muted-foreground">No risk rules recorded.</p>}
              {rules.map((r, i) => (
                <div
                  key={r.id}
                  className="animate-in fade-in slide-in-from-bottom-2 duration-300"
                  style={{ animationDelay: `${i * 60}ms`, animationFillMode: "backwards" }}
                >
                  <RuleCard rule={r} />
                </div>
              ))}
            </div>
          </div>

          {verifyItems.length > 0 && (
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                <ClipboardList className="h-4 w-4" /> Items to verify
              </h2>
              <ul className="mt-3 card-base divide-y divide-border/60 p-0">
                {verifyItems.map((v, i) => (
                  <li key={i} className="px-5 py-3 text-sm">
                    <span className="font-medium">{v.field}</span>
                    <span className="text-muted-foreground"> — {v.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.report_text && (
            <ReportCard reportText={data.report_text} reportPath={data.report_path} />
          )}
        </section>

        <aside className="space-y-6">
          <MetricList title="Key numbers" defs={UNIVERSAL_METRICS} bag={metrics} />
          {family && TYPE_METRICS[family].length > 0 && (
            <MetricList title={`${FAMILY_LABELS[family]} metrics`} defs={TYPE_METRICS[family]} bag={typeMetrics} />
          )}
        </aside>
      </div>
    </div>
  );
}

function HeroMetrics({ metrics, rules }: { metrics: MetricBag; rules: RiskRuleResult[] }) {
  const items: { label: string; key: string; unit: "usd" | "pct" | "ratio" }[] = [
    { label: "NOI", key: "noi", unit: "usd" },
    { label: "Going-in cap", key: "cap_rate_pct", unit: "pct" },
    { label: "DSCR", key: "dscr", unit: "ratio" },
    { label: "Occupancy", key: "occupancy_pct", unit: "pct" },
  ];
  const pass = rules.filter((r) => r.status === "pass").length;
  const flags = rules.filter((r) => r.status === "high" || r.status === "critical").length;
  const review = rules.filter((r) => r.status === "review").length;

  return (
    <div className="mt-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((it, i) => {
          const v = metrics[it.key];
          const missing = v === null || v === undefined || v === "";
          return (
            <div
              key={it.key}
              className="card-base p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-elevated animate-in fade-in slide-in-from-bottom-2"
              style={{ animationDelay: `${i * 60}ms`, animationFillMode: "backwards" }}
            >
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{it.label}</div>
              <div className={`font-display mt-2 text-3xl tabular ${missing ? "text-muted-foreground" : ""}`}>
                {missing ? "—" : formatMetric(v, it.unit)}
              </div>
            </div>
          );
        })}
      </div>
      {rules.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-success/10 px-2.5 py-1 text-success">{pass} pass</span>
          {flags > 0 && <span className="rounded-full bg-destructive/10 px-2.5 py-1 text-destructive">{flags} flag{flags > 1 ? "s" : ""}</span>}
          {review > 0 && <span className="rounded-full bg-info/10 px-2.5 py-1 text-info">{review} to review</span>}
        </div>
      )}
    </div>
  );
}

function MetricList({ title, defs, bag }: { title: string; defs: typeof UNIVERSAL_METRICS; bag: MetricBag }) {
  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <div className="mt-3 card-base p-5 space-y-2.5">
        {defs.map((d) => {
          const raw = bag[d.key];
          const missing = raw === null || raw === undefined || raw === "";
          return (
            <div key={d.key} className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-2 last:border-0 last:pb-0">
              <div className="text-xs text-muted-foreground">{d.label}</div>
              <div className={`tabular ${missing ? "italic text-muted-foreground" : "text-foreground"}`}>
                {missing ? "not found" : formatMetric(raw, d.unit)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReportCard({ reportText, reportPath }: { reportText: string; reportPath: string | null }) {
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    if (!reportPath) return;
    setDownloading(true);
    try {
      await downloadReport(reportPath);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Agent report</h2>
        {reportPath && (
          <button
            onClick={download}
            disabled={downloading}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-50"
          >
            {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Download PDF
          </button>
        )}
      </div>
      <div className="mt-3 card-base px-6 py-5">
        <Markdown text={reportText} />
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" /> Back to dashboard
    </Link>
  );
}

function RecommendationBanner({ row, reason, excluded }: { row: Row; reason: string; excluded: boolean }) {
  const recommendation = row.recommendation;
  const map: Record<Recommendation, { label: string; tone: "success" | "warning" | "destructive"; sub: string }> = {
    pursue: { label: "Pursue", tone: "success", sub: "All risk rules pass." },
    pursue_with_conditions: { label: "Pursue with conditions", tone: "warning", sub: "Resolve high-risk flags and items needing review before bidding." },
    pass: { label: "Excluded", tone: "destructive", sub: "Failed the risk screen — recommend declining." },
  };
  const cfg = recommendation ? map[recommendation] : excluded ? map.pass : null;
  if (!cfg) return null;

  const toneClasses: Record<string, string> = {
    success: "border-success/30 bg-success/5",
    warning: "border-warning/40 bg-warning/10",
    destructive: "border-destructive/30 bg-destructive/5",
  };
  const labelTone: Record<string, string> = {
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
  };
  const btnTone: Record<string, string> = {
    success: "bg-success text-success-foreground",
    warning: "bg-warning text-warning-foreground",
    destructive: "bg-destructive text-destructive-foreground",
  };

  const onDownload = () => generateReportPdf({
    file_name: row.file_name,
    property_name: row.property_name,
    property_subtype: row.property_subtype,
    property_type: row.property_type,
    location: row.location,
    created_at: row.created_at,
    recommendation: row.recommendation,
    metrics: row.metrics,
    type_metrics: row.type_metrics,
    risk_results: row.risk_results,
    verify_items: row.verify_items,
  });

  return (
    <div className={`mt-8 rounded-xl border p-6 ${toneClasses[cfg.tone]}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Recommendation</div>
          <div className={`font-display mt-1 text-4xl ${labelTone[cfg.tone]}`}>{cfg.label}</div>
          <p className="mt-2 max-w-2xl text-sm text-foreground/80">{reason || cfg.sub}</p>
        </div>
        <button
          onClick={onDownload}
          className={`inline-flex shrink-0 items-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium shadow-card transition hover:opacity-90 ${btnTone[cfg.tone]}`}
        >
          <Download className="h-4 w-4" /> Download report
        </button>
      </div>
    </div>
  );
}


function RuleCard({ rule }: { rule: RiskRuleResult }) {
  const cfg = statusCfg(rule.status);
  return (
    <div className="card-base p-5">
      <div className="flex items-start gap-4">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${cfg.bg}`}>{cfg.icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="font-medium">{rule.label}</div>
            <div className="flex items-center gap-2">
              {rule.value !== null && rule.value !== undefined && (
                <span className="font-mono text-sm tabular text-foreground/80">{rule.value}</span>
              )}
              <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${cfg.pill}`}>{cfg.label}</span>
            </div>
          </div>
          {rule.note && <p className="mt-1.5 text-sm text-muted-foreground">{rule.note}</p>}
          {rule.threshold && (
            <p className="mt-2 text-[11px] uppercase tracking-wider text-muted-foreground/80">
              Threshold: <span className="font-mono normal-case">{rule.threshold}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function statusCfg(s: RiskRuleResult["status"]) {
  switch (s) {
    case "pass":
      return { label: "Pass", icon: <CheckCircle2 className="h-4 w-4 text-success" />, bg: "bg-success/15", pill: "bg-success/10 text-success border-success/20" };
    case "high":
      return { label: "High Risk", icon: <AlertTriangle className="h-4 w-4 text-warning" />, bg: "bg-warning/20", pill: "bg-warning/15 text-warning border-warning/30" };
    case "critical":
      return { label: "Critical", icon: <XCircle className="h-4 w-4 text-destructive" />, bg: "bg-destructive/15", pill: "bg-destructive/10 text-destructive border-destructive/20" };
    case "review":
    default:
      return { label: "Needs review", icon: <HelpCircle className="h-4 w-4 text-info" />, bg: "bg-info/15", pill: "bg-info/10 text-info border-info/20" };
  }
}
