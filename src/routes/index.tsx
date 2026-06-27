import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAnalysesRealtime } from "@/hooks/use-analyses-realtime";
import { useCountUp } from "@/hooks/use-count-up";
import { CITY_HERO, CITY_SUNSET } from "@/lib/images";
import { ArrowUpRight, FileText, Plus, AlertTriangle, XCircle, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Property Pulse Check" },
      { name: "description", content: "Your commercial real estate OM screenings, with risk and recommendation at a glance." },
    ],
  }),
  component: Dashboard,
});

interface Row {
  id: string;
  file_name: string;
  property_name: string | null;
  status: string;
  recommendation: string | null;
  risk_results: { rules: { status: string }[]; decision: { reason: string } } | null;
  created_at: string;
}

function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["analyses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analyses")
        .select("id, file_name, property_name, status, recommendation, risk_results, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  // Live-update as n8n flips deals pending -> processing -> complete/excluded.
  useAnalysesRealtime(["analyses"]);

  const stats = computeStats(data ?? []);
  const [filter, setFilter] = useState<Filter>("all");
  const filtered = applyFilter(data ?? [], filter);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      {/* Cinematic skyline hero */}
      <section className="relative overflow-hidden rounded-2xl shadow-elevated">
        <img
          src={CITY_HERO}
          alt="City skyline"
          className="hero-zoom absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/88 via-black/60 to-black/25" />
        <div className="relative px-8 py-[4.5rem] sm:px-14 sm:py-[6.75rem]">
          <p className="text-xs uppercase tracking-[0.2em] text-accent/90 animate-in fade-in slide-in-from-bottom-2 duration-500">
            Commercial real estate · deal screening
          </p>
          <h1 className="font-script mt-3 max-w-3xl text-6xl leading-tight text-white sm:text-8xl animate-in fade-in slide-in-from-bottom-3 duration-700">
            Underwrite every deal in seconds.
          </h1>
          <p className="mt-4 max-w-xl text-sm text-white/85 sm:text-base animate-in fade-in slide-in-from-bottom-3 duration-700">
            Upload an Offering Memorandum. Property Pulse Check extracts the metrics, screens the risk, and returns a
            <span className="font-medium text-white"> pursue</span> verdict with a full report, or
            <span className="font-medium text-white"> excludes</span> it, with a downloadable report on every passing deal.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              to="/upload"
              className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground shadow-card transition hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> Screen a deal
            </Link>
          </div>
        </div>
      </section>

      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 animate-in fade-in slide-in-from-bottom-3 duration-500">
        <StatCard label="Deals screened" value={stats.total} icon={<FileText className="h-4 w-4" />} active={filter === "all"} onClick={() => setFilter("all")} />
        <StatCard label="Pursue" value={stats.pursue} icon={<CheckCircle2 className="h-4 w-4 text-success" />} active={filter === "pursue"} onClick={() => setFilter("pursue")} />
        <StatCard label="Conditional" value={stats.conditional} icon={<AlertTriangle className="h-4 w-4 text-warning" />} active={filter === "conditional"} onClick={() => setFilter("conditional")} />
        <StatCard label="Excluded" value={stats.pass} icon={<XCircle className="h-4 w-4 text-destructive" />} active={filter === "excluded"} onClick={() => setFilter("excluded")} />
      </div>

      <div className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">{filter === "all" ? "Recent screenings" : `${FILTER_LABEL[filter]} deals`}</h2>
          <div className="flex items-center gap-3">
            <p className="text-xs text-muted-foreground tabular">{filtered.length} {filter === "all" ? "total" : "shown"}</p>
            {filter !== "all" && (
              <button onClick={() => setFilter("all")} className="text-xs font-medium text-accent hover:underline">Show all</button>
            )}
          </div>
        </div>

        <div className="mt-4 card-base divide-y divide-border overflow-hidden">
          {isLoading && <SkeletonRows />}
          {!isLoading && (!data || data.length === 0) && <EmptyState />}
          {!isLoading && data && data.length > 0 && filtered.length === 0 && (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">No {FILTER_LABEL[filter].toLowerCase()} deals yet.</div>
          )}
          {!isLoading && filtered.map((row) => <DealRow key={row.id} row={row} />)}
        </div>
      </div>
    </div>
  );
}

function computeStats(rows: Row[]) {
  return {
    total: rows.length,
    pursue: rows.filter((r) => r.recommendation === "pursue").length,
    conditional: rows.filter((r) => r.recommendation === "pursue_with_conditions").length,
    pass: rows.filter((r) => r.recommendation === "pass").length,
  };
}

type Filter = "all" | "pursue" | "conditional" | "excluded";
const FILTER_LABEL: Record<Filter, string> = { all: "All", pursue: "Pursue", conditional: "Conditional", excluded: "Excluded" };

function applyFilter(rows: Row[], filter: Filter): Row[] {
  switch (filter) {
    case "pursue": return rows.filter((r) => r.recommendation === "pursue");
    case "conditional": return rows.filter((r) => r.recommendation === "pursue_with_conditions");
    case "excluded": return rows.filter((r) => r.status === "excluded" || r.recommendation === "pass");
    default: return rows;
  }
}

function StatCard({ label, value, icon, active, onClick }: { label: string; value: number; icon: React.ReactNode; active?: boolean; onClick?: () => void }) {
  const display = useCountUp(value);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`card-base p-4 text-left transition duration-200 hover:-translate-y-0.5 hover:shadow-elevated ${active ? "ring-2 ring-accent ring-offset-2 ring-offset-background" : ""}`}
    >
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-xs uppercase tracking-wider">{label}</span>
        {icon}
      </div>
      <div className="font-display mt-3 text-4xl tabular">{display}</div>
    </button>
  );
}

function DealRow({ row }: { row: Row }) {
  const ruleCounts = countRules(row.risk_results?.rules ?? []);
  return (
    <Link
      to="/analysis/$id"
      params={{ id: row.id }}
      className="flex items-center gap-4 px-5 py-4 transition hover:bg-secondary/50"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary text-primary">
        <FileText className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">
          {row.property_name || row.file_name}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {row.property_name ? row.file_name : "Untitled property"} · {new Date(row.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
        </div>
      </div>
      <div className="hidden items-center gap-1.5 sm:flex">
        {ruleCounts.healthy > 0 && <Pill tone="success">{ruleCounts.healthy} healthy</Pill>}
        {ruleCounts.high > 0 && <Pill tone="warning">{ruleCounts.high} high</Pill>}
        {ruleCounts.critical > 0 && <Pill tone="destructive">{ruleCounts.critical} critical</Pill>}
        {ruleCounts.review > 0 && <Pill tone="info">{ruleCounts.review} review</Pill>}
      </div>
      <RecommendationBadge value={row.recommendation} status={row.status} />
      <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
    </Link>
  );
}

function countRules(rules: { status: string }[]) {
  return {
    healthy: rules.filter((r) => r.status === "pass").length,
    high: rules.filter((r) => r.status === "high").length,
    critical: rules.filter((r) => r.status === "critical").length,
    review: rules.filter((r) => r.status === "review").length,
  };
}


function RecommendationBadge({ value, status }: { value: string | null; status: string }) {
  if (status === "pending") return <Pill tone="muted">Queued…</Pill>;
  if (status === "processing") return <Pill tone="muted">Processing…</Pill>;
  if (status === "failed") return <Pill tone="destructive">Failed</Pill>;
  if (status === "excluded") return <Pill tone="destructive">Excluded</Pill>;
  if (value === "pursue") return <Pill tone="success">Pursue</Pill>;
  if (value === "pursue_with_conditions") return <Pill tone="warning">Conditional</Pill>;
  if (value === "pass") return <Pill tone="destructive">Pass</Pill>;
  return <Pill tone="muted">—</Pill>;
}

function Pill({ tone, children }: { tone: "success" | "warning" | "destructive" | "info" | "muted"; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    success: "bg-success/10 text-success border-success/20",
    warning: "bg-warning/15 text-warning border-warning/30",
    destructive: "bg-destructive/10 text-destructive border-destructive/20",
    info: "bg-info/10 text-info border-info/20",
    muted: "bg-secondary text-muted-foreground border-border",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium tabular ${tones[tone]}`}>
      {children}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="overflow-hidden">
      <div className="relative h-44">
        <img src={CITY_SUNSET} alt="" className="absolute inset-0 h-full w-full object-cover opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/40 to-transparent" />
      </div>
      <div className="px-8 pb-12 pt-2 text-center">
        <h3 className="text-base font-semibold">No screenings yet</h3>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          Upload your first OM to see extracted metrics, the risk screen and a pursue-or-exclude verdict here.
        </p>
        <Link
          to="/upload"
          className="mt-5 inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Upload OM
        </Link>
      </div>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="divide-y divide-border">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <div className="h-10 w-10 rounded-md bg-secondary animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 rounded bg-secondary animate-pulse" />
            <div className="h-2 w-1/4 rounded bg-secondary animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
