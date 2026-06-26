import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import { ArrowLeft, CheckCircle2, AlertTriangle, XCircle, HelpCircle, Loader2, FileText, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/analysis/$id")({
  head: () => ({
    meta: [
      { title: "Risk results — Ledger" },
      { name: "description", content: "Detailed risk-rule results and recommendation for an uploaded multifamily OM." },
    ],
  }),
  component: AnalysisPage,
});

type RuleStatus = "pass" | "caution" | "fail" | "needs_manual_review";

interface Rule {
  id: string;
  label: string;
  status: RuleStatus;
  metric?: string;
  threshold?: string;
  detail: string;
}

interface Extracted {
  property_name?: { value: string | null };
  units?: { value: number | null; confidence: string };
  purchase_price?: { value: number | null; confidence: string };
  gross_income?: { value: number | null; confidence: string };
  operating_expenses?: { value: number | null; confidence: string };
  noi?: { value: number | null; confidence: string };
  annual_debt_service?: { value: number | null; confidence: string };
  occupancy_pct?: { value: number | null; confidence: string };
  avg_actual_rent?: { value: number | null; confidence: string };
  avg_market_rent?: { value: number | null; confidence: string };
  cap_rate_pct?: { value: number | null; confidence: string };
  estimated_repair_cost?: { value: number | null; confidence: string };
}

interface Row {
  id: string;
  file_name: string;
  property_name: string | null;
  status: string;
  recommendation: "pursue" | "pursue_with_conditions" | "pass" | null;
  extracted_data: Extracted | null;
  risk_results: { rules: Rule[]; decision: { reason: string } } | null;
  error_message: string | null;
  created_at: string;
}

function AnalysisPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const { data, isLoading } = useQuery({
    queryKey: ["analysis", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("analyses").select("*").eq("id", id).single();
      if (error) throw error;
      return data as Row;
    },
    refetchInterval: (q) => (q.state.data?.status === "processing" ? 1500 : false),
  });

  // Re-render when processing completes
  useEffect(() => {
    if (data?.status === "complete") router.invalidate();
  }, [data?.status, router]);

  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-20 text-center text-muted-foreground">
        <Loader2 className="mx-auto h-6 w-6 animate-spin" />
        <p className="mt-3 text-sm">Loading…</p>
      </div>
    );
  }

  if (data.status === "processing") {
    return (
      <div className="mx-auto max-w-3xl px-6 py-20 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
        <h1 className="font-display mt-6 text-3xl">Analyzing OM…</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Extracting numbers and running risk rules. This usually takes 20–60 seconds.
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
          <Link to="/upload" className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            <RefreshCw className="h-4 w-4" /> Try again
          </Link>
        </div>
      </div>
    );
  }

  const rules = data.risk_results?.rules ?? [];
  const decision = data.risk_results?.decision;
  const extracted = data.extracted_data ?? {};

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <BackLink />

      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Risk results</p>
          <h1 className="font-display mt-2 text-4xl">{data.property_name || data.file_name}</h1>
          <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            <span className="truncate">{data.file_name}</span>
            <span>·</span>
            <span>{new Date(data.created_at).toLocaleString()}</span>
          </p>
        </div>
      </div>

      <RecommendationBanner recommendation={data.recommendation} reason={decision?.reason ?? ""} />

      <div className="mt-10 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Risk rules</h2>
          <div className="mt-3 space-y-3">
            {rules.map((r) => <RuleCard key={r.id} rule={r} />)}
          </div>
        </section>

        <aside>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Key numbers</h2>
          <div className="mt-3 card-base p-5 space-y-3">
            <KV label="Units" value={fmtNum(extracted.units?.value)} confidence={extracted.units?.confidence} />
            <KV label="Purchase price" value={fmtMoney(extracted.purchase_price?.value)} confidence={extracted.purchase_price?.confidence} />
            <KV label="Gross income" value={fmtMoney(extracted.gross_income?.value)} confidence={extracted.gross_income?.confidence} />
            <KV label="Operating expenses" value={fmtMoney(extracted.operating_expenses?.value)} confidence={extracted.operating_expenses?.confidence} />
            <KV label="NOI" value={fmtMoney(extracted.noi?.value)} confidence={extracted.noi?.confidence} bold />
            <KV label="Annual debt service" value={fmtMoney(extracted.annual_debt_service?.value)} confidence={extracted.annual_debt_service?.confidence} />
            <KV label="Occupancy" value={fmtPct(extracted.occupancy_pct?.value)} confidence={extracted.occupancy_pct?.confidence} />
            <KV label="Cap rate" value={fmtPct(extracted.cap_rate_pct?.value)} confidence={extracted.cap_rate_pct?.confidence} />
            <KV label="Avg actual rent" value={fmtMoney(extracted.avg_actual_rent?.value) + "/mo"} confidence={extracted.avg_actual_rent?.confidence} />
            <KV label="Avg market rent" value={fmtMoney(extracted.avg_market_rent?.value) + "/mo"} confidence={extracted.avg_market_rent?.confidence} />
            <KV label="Est. repair cost" value={fmtMoney(extracted.estimated_repair_cost?.value)} confidence={extracted.estimated_repair_cost?.confidence} />
          </div>
        </aside>
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

function RecommendationBanner({ recommendation, reason }: { recommendation: Row["recommendation"]; reason: string }) {
  const map = {
    pursue: { label: "Pursue", tone: "success" as const, sub: "All risk rules cleared." },
    pursue_with_conditions: { label: "Pursue with conditions", tone: "warning" as const, sub: "Confirm caution items and review unverified figures before bidding." },
    pass: { label: "Pass", tone: "destructive" as const, sub: "Material risk exposure — recommend declining." },
  };
  const cfg = recommendation ? map[recommendation] : null;
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

  return (
    <div className={`mt-8 rounded-xl border p-6 ${toneClasses[cfg.tone]}`}>
      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Recommendation</div>
      <div className={`font-display mt-1 text-4xl ${labelTone[cfg.tone]}`}>{cfg.label}</div>
      <p className="mt-2 text-sm text-foreground/80">{reason || cfg.sub}</p>
    </div>
  );
}

function RuleCard({ rule }: { rule: Rule }) {
  const cfg = statusCfg(rule.status);
  return (
    <div className="card-base p-5">
      <div className="flex items-start gap-4">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${cfg.bg}`}>
          {cfg.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="font-medium">{rule.label}</div>
            <div className="flex items-center gap-2">
              {rule.metric && <span className="font-mono text-sm tabular text-foreground/80">{rule.metric}</span>}
              <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${cfg.pill}`}>{cfg.label}</span>
            </div>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">{rule.detail}</p>
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

function statusCfg(s: RuleStatus) {
  switch (s) {
    case "pass":
      return { label: "Pass", icon: <CheckCircle2 className="h-4 w-4 text-success" />, bg: "bg-success/15", pill: "bg-success/10 text-success border-success/20" };
    case "caution":
      return { label: "Caution", icon: <AlertTriangle className="h-4 w-4 text-warning" />, bg: "bg-warning/20", pill: "bg-warning/15 text-warning border-warning/30" };
    case "fail":
      return { label: "Fail", icon: <XCircle className="h-4 w-4 text-destructive" />, bg: "bg-destructive/15", pill: "bg-destructive/10 text-destructive border-destructive/20" };
    case "needs_manual_review":
      return { label: "Needs review", icon: <HelpCircle className="h-4 w-4 text-info" />, bg: "bg-info/15", pill: "bg-info/10 text-info border-info/20" };
  }
}

function KV({ label, value, confidence, bold }: { label: string; value: string; confidence?: string; bold?: boolean }) {
  const isMissing = confidence === "missing" || value === "—" || value === "—/mo";
  const isLow = confidence === "low";
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-2 last:border-0 last:pb-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`tabular ${bold ? "font-semibold" : ""} ${isMissing ? "text-muted-foreground italic" : "text-foreground"}`}>
        {isMissing ? "not found" : value}
        {isLow && !isMissing && <span className="ml-1.5 rounded-full bg-warning/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-warning">low conf.</span>}
      </div>
    </div>
  );
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return "$" + Math.round(n).toLocaleString();
}
function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toFixed(1) + "%";
}
function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString();
}
