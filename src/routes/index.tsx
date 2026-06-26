import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAnalysesRealtime } from "@/hooks/use-analyses-realtime";
import { ArrowUpRight, FileText, Plus, TrendingUp, AlertTriangle, XCircle, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Ledger" },
      { name: "description", content: "Your multifamily OM screenings, with risk and recommendation at a glance." },
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

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Dashboard</p>
          <h1 className="font-display mt-2 text-5xl">Deal pipeline</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Upload an Offering Memorandum and Ledger pulls the income, debt, occupancy, rent roll and repair numbers, then screens them against five risk rules.
          </p>
        </div>
        <Link
          to="/upload"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> New screening
        </Link>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 animate-in fade-in slide-in-from-bottom-3 duration-500">
        <StatCard label="Deals screened" value={stats.total.toString()} icon={<FileText className="h-4 w-4" />} />
        <StatCard label="Pursue" value={stats.pursue.toString()} icon={<CheckCircle2 className="h-4 w-4 text-success" />} />
        <StatCard label="Conditional" value={stats.conditional.toString()} icon={<AlertTriangle className="h-4 w-4 text-warning" />} />
        <StatCard label="Pass" value={stats.pass.toString()} icon={<XCircle className="h-4 w-4 text-destructive" />} />
      </div>

      <div className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Recent screenings</h2>
          {data && data.length > 0 && (
            <p className="text-xs text-muted-foreground tabular">{data.length} total</p>
          )}
        </div>

        <div className="mt-4 card-base divide-y divide-border overflow-hidden">
          {isLoading && <SkeletonRows />}
          {!isLoading && (!data || data.length === 0) && <EmptyState />}
          {!isLoading && data && data.map((row) => <DealRow key={row.id} row={row} />)}
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

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="card-base p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-elevated">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-xs uppercase tracking-wider">{label}</span>
        {icon}
      </div>
      <div className="font-display mt-3 text-4xl tabular">{value}</div>
    </div>
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
    <div className="px-8 py-16 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
        <TrendingUp className="h-5 w-5 text-muted-foreground" />
      </div>
      <h3 className="mt-4 text-base font-semibold">No screenings yet</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        Upload your first multifamily OM to see extracted numbers, risk-rule status and a recommendation here.
      </p>
      <Link
        to="/upload"
        className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        <Plus className="h-4 w-4" /> Upload OM
      </Link>
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
