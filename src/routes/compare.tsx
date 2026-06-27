import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ScatterChart,
  Scatter,
  Cell,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAnalysesRealtime } from "@/hooks/use-analyses-realtime";
import {
  UNIVERSAL_METRICS,
  TYPE_METRICS,
  SUBTYPE_TO_FAMILY,
  FAMILY_LABELS,
  type PropertyFamily,
  type PropertySubtype,
  type MetricDef,
} from "@/lib/screening/taxonomy";
import { formatMetric } from "@/lib/screening/format";
import { GitCompareArrows, Layers } from "lucide-react";

export const Route = createFileRoute("/compare")({
  head: () => ({
    meta: [
      { title: "Compare deals — Property Pulse Check" },
      { name: "description", content: "Side-by-side comparison of screened deals — like-with-like or on universal metrics." },
    ],
  }),
  component: ComparePage,
});

type MetricBag = Record<string, number | string | null>;

interface CompareRow {
  id: string;
  file_name: string;
  property_name: string | null;
  property_type: string | null;
  property_subtype: string | null;
  status: string;
  recommendation: string | null;
  metrics: MetricBag | null;
  type_metrics: MetricBag | null;
}

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#8b5cf6", "#ec4899", "#84cc16"];

function familyOf(d: CompareRow): PropertyFamily | null {
  if (d.property_subtype && d.property_subtype in SUBTYPE_TO_FAMILY) {
    return SUBTYPE_TO_FAMILY[d.property_subtype as PropertySubtype];
  }
  if (d.property_type && d.property_type in FAMILY_LABELS) return d.property_type as PropertyFamily;
  return null;
}

function dealName(d: CompareRow): string {
  return d.property_name || d.file_name;
}

function metricValue(d: CompareRow, key: string): number | string | null {
  const m = d.metrics ?? {};
  const tm = d.type_metrics ?? {};
  return m[key] ?? tm[key] ?? null;
}

function numVal(d: CompareRow, key: string): number | null {
  const v = metricValue(d, key);
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function ComparePage() {
  const { data } = useQuery({
    queryKey: ["analyses-compare"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analyses")
        .select("id, file_name, property_name, property_type, property_subtype, status, recommendation, metrics, type_metrics")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as CompareRow[];
    },
  });
  useAnalysesRealtime(["analyses-compare"]);

  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<"like" | "universal">("like");
  const [metricKey, setMetricKey] = useState<string>("noi");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const pool = (data ?? []).filter((d) => d.metrics && Object.keys(d.metrics).length > 0);
  const selectedDeals = pool.filter((d) => selected.includes(d.id));

  // In like-with-like mode, the first selected deal anchors the family.
  const anchorFamily = mode === "like" && selectedDeals.length ? familyOf(selectedDeals[0]) : null;

  const metricDefs: MetricDef[] =
    mode === "universal"
      ? UNIVERSAL_METRICS
      : anchorFamily
        ? [...UNIVERSAL_METRICS, ...TYPE_METRICS[anchorFamily]]
        : UNIVERSAL_METRICS;

  const numericDefs = metricDefs.filter((d) => d.unit !== "text" && d.unit !== "year");
  const activeMetric = numericDefs.find((d) => d.key === metricKey) ?? numericDefs[0];

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const isDisabled = (d: CompareRow): boolean =>
    mode === "like" && anchorFamily !== null && !selected.includes(d.id) && familyOf(d) !== anchorFamily;

  const barData = activeMetric
    ? selectedDeals.map((d, i) => ({ name: dealName(d), value: numVal(d, activeMetric.key), fill: COLORS[i % COLORS.length] }))
    : [];

  const scatterData = selectedDeals
    .map((d, i) => ({ name: dealName(d), x: numVal(d, "cap_rate_pct"), y: numVal(d, "dscr"), fill: COLORS[i % COLORS.length] }))
    .filter((p) => p.x !== null && p.y !== null);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Compare</p>
          <h1 className="font-display mt-2 text-5xl">Deal comparison</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Pick two or more screened deals. Like-with-like compares the full metric set within one property type;
            Universal compares the shared core across any types.
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-border bg-surface p-1 text-sm">
          <button
            onClick={() => setMode("like")}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 ${mode === "like" ? "bg-secondary font-medium text-foreground" : "text-muted-foreground"}`}
          >
            <GitCompareArrows className="h-4 w-4" /> Like-with-like
          </button>
          <button
            onClick={() => setMode("universal")}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 ${mode === "universal" ? "bg-secondary font-medium text-foreground" : "text-muted-foreground"}`}
          >
            <Layers className="h-4 w-4" /> Universal
          </button>
        </div>
      </div>

      {pool.length === 0 ? (
        <div className="card-base mt-10 px-8 py-16 text-center text-sm text-muted-foreground">
          No screened deals with metrics yet. Run a few screens first, then compare them here.
        </div>
      ) : (
        <>
          <div className="mt-8">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Select deals {anchorFamily && <span className="ml-1 normal-case text-muted-foreground/80">· {FAMILY_LABELS[anchorFamily]} only</span>}
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {pool.map((d) => {
                const on = selected.includes(d.id);
                const disabled = isDisabled(d);
                return (
                  <button
                    key={d.id}
                    onClick={() => toggle(d.id)}
                    disabled={disabled}
                    className={`rounded-full border px-3 py-1.5 text-sm transition ${
                      on ? "border-primary bg-primary/10 text-foreground" : "border-border bg-surface text-muted-foreground hover:bg-secondary"
                    } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
                  >
                    {dealName(d)}
                    <span className="ml-1.5 text-[10px] uppercase text-muted-foreground/70">
                      {familyOf(d) ? FAMILY_LABELS[familyOf(d) as PropertyFamily].split(" ")[0] : "—"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {selectedDeals.length < 2 ? (
            <div className="card-base mt-8 px-8 py-12 text-center text-sm text-muted-foreground">
              Select at least two deals to compare.
            </div>
          ) : (
            <div className="mt-8 space-y-8">
              {/* Metric bar chart */}
              <section className="card-base p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold">Metric comparison</h2>
                  <select
                    value={activeMetric?.key ?? ""}
                    onChange={(e) => setMetricKey(e.target.value)}
                    className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm"
                  >
                    {numericDefs.map((d) => (<option key={d.key} value={d.key}>{d.label}</option>))}
                  </select>
                </div>
                <div className="mt-5 h-72">
                  {mounted && (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={barData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
                        <YAxis tick={{ fontSize: 11 }} width={70} />
                        <Tooltip formatter={(v: number) => (activeMetric ? formatMetric(v, activeMetric.unit) : v)} />
                        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                          {barData.map((entry, i) => (<Cell key={i} fill={entry.fill} />))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </section>

              {/* Cap rate vs DSCR scatter */}
              {scatterData.length > 0 && (
                <section className="card-base p-6">
                  <h2 className="text-sm font-semibold">Going-in cap rate vs DSCR</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Higher cap = cheaper; higher DSCR = safer leverage. Top-right is the sweet spot.</p>
                  <div className="mt-5 h-72">
                    {mounted && (
                      <ResponsiveContainer width="100%" height="100%">
                        <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis type="number" dataKey="x" name="Cap rate" unit="%" tick={{ fontSize: 11 }}
                            label={{ value: "Cap rate (%)", position: "bottom", fontSize: 11 }} />
                          <YAxis type="number" dataKey="y" name="DSCR" tick={{ fontSize: 11 }} width={48}
                            label={{ value: "DSCR", angle: -90, position: "insideLeft", fontSize: 11 }} />
                          <Tooltip cursor={{ strokeDasharray: "3 3" }}
                            formatter={(v: number, n: string) => (n === "DSCR" ? v.toFixed(2) + "x" : v.toFixed(2) + "%")}
                            labelFormatter={() => ""} />
                          <Scatter data={scatterData}>
                            {scatterData.map((entry, i) => (<Cell key={i} fill={entry.fill} />))}
                          </Scatter>
                        </ScatterChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </section>
              )}

              {/* Comparison table */}
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Side by side</h2>
                <div className="mt-3 card-base overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="px-4 py-3 font-medium text-muted-foreground">Metric</th>
                        {selectedDeals.map((d, i) => (
                          <th key={d.id} className="px-4 py-3 font-medium" style={{ color: COLORS[i % COLORS.length] }}>
                            {dealName(d)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {metricDefs.map((def) => (
                        <tr key={def.key} className="border-b border-border/60 last:border-0">
                          <td className="px-4 py-2.5 text-muted-foreground">{def.label}</td>
                          {selectedDeals.map((d) => {
                            const v = metricValue(d, def.key);
                            const missing = v === null || v === undefined || v === "";
                            return (
                              <td key={d.id} className={`px-4 py-2.5 tabular ${missing ? "italic text-muted-foreground" : ""}`}>
                                {missing ? "—" : formatMetric(v, def.unit)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
