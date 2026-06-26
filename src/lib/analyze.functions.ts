import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";

type Confidence = "high" | "low" | "missing";

interface FieldValue<T = number> {
  value: T | null;
  confidence: Confidence;
  note?: string;
}

interface Extracted {
  property_name: FieldValue<string>;
  units: FieldValue;
  purchase_price: FieldValue;
  gross_income: FieldValue;
  operating_expenses: FieldValue;
  noi: FieldValue;
  noi_margin_pct: FieldValue;
  market_avg_noi_margin_pct: FieldValue;
  annual_debt_service: FieldValue;
  dscr: FieldValue;
  occupancy_pct: FieldValue;
  vacancy_pct: FieldValue;
  avg_actual_rent: FieldValue;
  avg_market_rent: FieldValue;
  cap_rate_pct: FieldValue;
  estimated_repair_cost: FieldValue;
  deferred_capex: FieldValue;
  top_tenant_income_pct: FieldValue;
  top_tenant_name: FieldValue<string>;
  top_tenant_shrinking: FieldValue<boolean>;
}

const EXTRACT_PROMPT = `You are a multifamily real-estate underwriter. Read the attached Offering Memorandum (OM) PDF and extract the fields below. For every field also rate confidence:
- "high" — value is clearly stated in the doc
- "low"  — inferred or partially stated
- "missing" — not findable

Do NOT guess. If you cannot find a value, return null with confidence "missing".

Return STRICT JSON only (no markdown, no prose), matching this exact shape:

{
  "property_name": {"value": string|null, "confidence": "..."},
  "units": {"value": number|null, "confidence": "..."},
  "purchase_price": {"value": number|null, "confidence": "..."},
  "gross_income": {"value": number|null, "confidence": "..."},
  "operating_expenses": {"value": number|null, "confidence": "..."},
  "noi": {"value": number|null, "confidence": "..."},
  "noi_margin_pct": {"value": number|null, "confidence": "...", "note": "NOI / gross income, as a percentage"},
  "market_avg_noi_margin_pct": {"value": number|null, "confidence": "...", "note": "market/submarket average NOI margin if cited, else missing"},
  "annual_debt_service": {"value": number|null, "confidence": "..."},
  "dscr": {"value": number|null, "confidence": "...", "note": "stated DSCR if cited"},
  "occupancy_pct": {"value": number|null, "confidence": "..."},
  "vacancy_pct": {"value": number|null, "confidence": "...", "note": "physical or economic vacancy as cited"},
  "avg_actual_rent": {"value": number|null, "confidence": "...", "note": "monthly avg in-place rent"},
  "avg_market_rent": {"value": number|null, "confidence": "...", "note": "monthly avg market/proforma rent"},
  "cap_rate_pct": {"value": number|null, "confidence": "..."},
  "estimated_repair_cost": {"value": number|null, "confidence": "...", "note": "total repairs/value-add capex budget"},
  "deferred_capex": {"value": number|null, "confidence": "...", "note": "deferred maintenance / immediate capex needed"},
  "top_tenant_income_pct": {"value": number|null, "confidence": "...", "note": "% of total rental income from the single largest tenant OR single largest employer/industry concentration in the submarket. For workforce multifamily, this is usually the largest employer concentration of the resident base."},
  "top_tenant_name": {"value": string|null, "confidence": "...", "note": "name of that tenant / employer / industry"},
  "top_tenant_shrinking": {"value": boolean|null, "confidence": "...", "note": "true ONLY if the OM explicitly indicates that tenant / employer / industry is shrinking, laying off, declining, or losing market share. Otherwise false. If silent, missing."}
}

All money in USD whole dollars. Occupancy, vacancy, cap rate, DSCR margin all as percentage numbers (e.g. 92.5 not 0.925). DSCR is a ratio number (e.g. 1.30).`;

type RiskStatus = "healthy" | "high_risk" | "critical_risk" | "needs_manual_review";

interface RiskResult {
  id: string;
  label: string;
  status: RiskStatus;
  detail: string;
  metric?: string;
  threshold: string;
}

function evalRisks(d: Extracted): RiskResult[] {
  const results: RiskResult[] = [];
  const ok = <T,>(f: FieldValue<T> | undefined) => !!(f && f.value !== null && f.value !== undefined && f.confidence !== "missing");

  // 1. Occupancy + Vacancy
  {
    const occOk = ok(d.occupancy_pct);
    const vacOk = ok(d.vacancy_pct);
    if (!occOk && !vacOk) {
      results.push(review("occupancy", "Occupancy & Vacancy",
        "Neither occupancy nor vacancy was confidently stated in the OM.",
        "L1: occ ≤ 85% & vac < 5%  ·  L2: occ < 80% & vac > 5%"));
    } else {
      const occ = d.occupancy_pct.value as number | null;
      const vac = (d.vacancy_pct.value as number | null) ?? (occ !== null ? 100 - occ : null);
      let status: RiskStatus = "healthy";
      let detail = `Occupancy ${occ !== null ? occ.toFixed(1) + "%" : "n/a"}, vacancy ${vac !== null ? vac.toFixed(1) + "%" : "n/a"}.`;
      if (occ !== null && vac !== null) {
        if (occ < 80 && vac > 5) { status = "critical_risk"; detail += " Occupancy below 80% with vacancy above 5%."; }
        else if (occ <= 85 && vac < 5) { status = "high_risk"; detail += " Soft occupancy with minimal slack in vacancy."; }
        else { detail += " Within healthy band."; }
      } else {
        status = "needs_manual_review";
        detail = "Only partial occupancy/vacancy data — confirm both figures.";
      }
      results.push({
        id: "occupancy", label: "Occupancy & Vacancy", status, detail,
        metric: `${occ !== null ? occ.toFixed(1) + "%" : "—"} occ · ${vac !== null ? vac.toFixed(1) + "%" : "—"} vac`,
        threshold: "L1: occ ≤ 85% & vac < 5%  ·  L2: occ < 80% & vac > 5%",
      });
    }
  }

  // 2. DSCR — healthy if > 1.35, else high risk
  {
    let dscr: number | null = null;
    if (ok(d.dscr)) dscr = d.dscr.value as number;
    else if (ok(d.noi) && ok(d.annual_debt_service) && (d.annual_debt_service.value as number) > 0) {
      dscr = (d.noi.value as number) / (d.annual_debt_service.value as number);
    }
    if (dscr === null) {
      results.push(review("dscr", "Debt Service Coverage Ratio",
        "DSCR not stated and NOI or annual debt service could not be confidently extracted.",
        "L1: > 1.35x healthy  ·  L2: ≤ 1.35x high risk"));
    } else {
      const status: RiskStatus = dscr > 1.35 ? "healthy" : "high_risk";
      results.push({
        id: "dscr", label: "Debt Service Coverage Ratio", status,
        metric: dscr.toFixed(2) + "x",
        threshold: "L1: > 1.35x healthy  ·  L2: ≤ 1.35x high risk",
        detail: status === "healthy"
          ? "DSCR clears the 1.35x healthy threshold."
          : "DSCR is at or below 1.35x — thin coverage against debt service.",
      });
    }
  }

  // 3. Cap rate — high if < 5%; critical if < 5% AND vacancy > 10%
  {
    if (!ok(d.cap_rate_pct)) {
      results.push(review("cap_rate", "Going-in Cap Rate",
        "Cap rate not confidently stated.",
        "L1: cap < 5%  ·  L2: cap < 5% & vacancy > 10%"));
    } else {
      const cap = d.cap_rate_pct.value as number;
      const occ = ok(d.occupancy_pct) ? (d.occupancy_pct.value as number) : null;
      const vac = ok(d.vacancy_pct) ? (d.vacancy_pct.value as number) : (occ !== null ? 100 - occ : null);
      let status: RiskStatus = "healthy";
      let detail = `Cap rate ${cap.toFixed(2)}%.`;
      if (cap < 5) {
        if (vac !== null && vac > 10) { status = "critical_risk"; detail += ` Compressed yield combined with ${vac.toFixed(1)}% vacancy.`; }
        else if (vac === null) { status = "high_risk"; detail += " Compressed yield; vacancy not confirmed — re-check before bidding."; }
        else { status = "high_risk"; detail += " Yield below 5% — pricing aggressive relative to risk."; }
      } else {
        detail += " At or above the 5% threshold.";
      }
      results.push({
        id: "cap_rate", label: "Going-in Cap Rate", status, detail,
        metric: cap.toFixed(2) + "%",
        threshold: "L1: cap < 5%  ·  L2: cap < 5% & vacancy > 10%",
      });
    }
  }

  // 4. Tenant / employer concentration
  {
    if (!ok(d.top_tenant_income_pct)) {
      results.push(review("tenant_concentration", "Income Concentration",
        "Tenant or employer concentration not confidently stated in the OM.",
        "L1: >25% from one source  ·  L2: that source is shrinking"));
    } else {
      const pct = d.top_tenant_income_pct.value as number;
      const who = ok(d.top_tenant_name) ? (d.top_tenant_name.value as string) : "single source";
      const shrinkingKnown = d.top_tenant_shrinking && d.top_tenant_shrinking.confidence !== "missing";
      const shrinking = shrinkingKnown && d.top_tenant_shrinking.value === true;
      let status: RiskStatus = "healthy";
      let detail = `${pct.toFixed(1)}% of income tied to ${who}.`;
      if (pct > 25) {
        if (shrinking) { status = "critical_risk"; detail += " OM signals that source is contracting."; }
        else if (!shrinkingKnown) { status = "high_risk"; detail += " Trajectory of that source not confirmed — verify employer/industry health."; }
        else { status = "high_risk"; detail += " Single source carries the rent roll."; }
      } else {
        detail += " Below 25% concentration threshold.";
      }
      results.push({
        id: "tenant_concentration", label: "Income Concentration", status, detail,
        metric: pct.toFixed(1) + "%",
        threshold: "L1: >25% from one source  ·  L2: that source is shrinking",
      });
    }
  }

  // 5. Deferred capex vs purchase price; critical if also NOI margin below market
  {
    const capex = ok(d.deferred_capex) ? (d.deferred_capex.value as number)
                : ok(d.estimated_repair_cost) ? (d.estimated_repair_cost.value as number) : null;
    if (capex === null || !ok(d.purchase_price) || (d.purchase_price.value as number) <= 0) {
      results.push(review("capex", "Deferred CapEx vs Price",
        "Deferred capex or purchase price not confidently stated.",
        "L1: capex > 5% of price  ·  L2: also NOI margin below market"));
    } else {
      const price = d.purchase_price.value as number;
      const ratio = (capex / price) * 100;
      const noiM = ok(d.noi_margin_pct) ? (d.noi_margin_pct.value as number) : null;
      const mktM = ok(d.market_avg_noi_margin_pct) ? (d.market_avg_noi_margin_pct.value as number) : null;
      const noiBelowMarket = noiM !== null && mktM !== null && noiM < mktM;
      const marginCheckKnown = noiM !== null && mktM !== null;

      let status: RiskStatus = "healthy";
      let detail = `Deferred capex ${fmtMoney(capex)} on price ${fmtMoney(price)} (${ratio.toFixed(1)}%).`;
      if (ratio > 5) {
        if (noiBelowMarket) { status = "critical_risk"; detail += ` NOI margin ${noiM!.toFixed(1)}% vs market ${mktM!.toFixed(1)}% — under-earning a needy asset.`; }
        else if (!marginCheckKnown) { status = "high_risk"; detail += " NOI margin vs market not confirmed — verify before assuming yield."; }
        else { status = "high_risk"; detail += " Heavy capex burden, but NOI margin holds up."; }
      } else {
        detail += " Within the 5% comfort band.";
      }
      results.push({
        id: "capex", label: "Deferred CapEx vs Price", status, detail,
        metric: ratio.toFixed(1) + "%",
        threshold: "L1: capex > 5% of price  ·  L2: also NOI margin below market",
      });
    }
  }

  return results;
}

function review(id: string, label: string, detail: string, threshold: string): RiskResult {
  return { id, label, status: "needs_manual_review", detail, threshold };
}

function fmtMoney(n: number): string {
  return "$" + Math.round(n).toLocaleString();
}

function decideRecommendation(rs: RiskResult[]): { recommendation: "pursue" | "pursue_with_conditions" | "pass"; reason: string } {
  const critical = rs.filter((r) => r.status === "critical_risk");
  const high = rs.filter((r) => r.status === "high_risk");
  const reviews = rs.filter((r) => r.status === "needs_manual_review");

  if (critical.length >= 1) {
    const which = critical.map((r) => r.label).join(", ");
    return { recommendation: "pass", reason: `Critical risk flagged on ${which}.` };
  }
  if (high.length + reviews.length === 0) {
    return { recommendation: "pursue", reason: "All five rules are healthy." };
  }
  const parts: string[] = [];
  if (high.length) parts.push(`${high.length} high-risk flag${high.length === 1 ? "" : "s"}`);
  if (reviews.length) parts.push(`${reviews.length} item${reviews.length === 1 ? "" : "s"} needing manual review`);
  return { recommendation: "pursue_with_conditions", reason: parts.join(" and ") + "." };
}

export const analyzeOM = createServerFn({ method: "POST" })
  .inputValidator((input: { file_name: string; file_base64: string; mime_type: string }) => input)
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI gateway not configured.");

    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });

    const { data: row, error: insErr } = await supabase
      .from("analyses")
      .insert({ file_name: data.file_name, status: "processing" })
      .select()
      .single();
    if (insErr || !row) throw new Error(insErr?.message ?? "Failed to create analysis record.");

    try {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Lovable-API-Key": apiKey,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: EXTRACT_PROMPT },
                {
                  type: "file",
                  file: {
                    filename: data.file_name,
                    file_data: `data:${data.mime_type};base64,${data.file_base64}`,
                  },
                },
              ],
            },
          ],
          response_format: { type: "json_object" },
        }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`AI gateway error ${resp.status}: ${text.slice(0, 200)}`);
      }

      const json = await resp.json();
      const content: string = json.choices?.[0]?.message?.content ?? "{}";
      const cleaned = content.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      const extracted = JSON.parse(cleaned) as Extracted;

      const risks = evalRisks(extracted);
      const decision = decideRecommendation(risks);

      await supabase
        .from("analyses")
        .update({
          status: "complete",
          property_name: extracted.property_name?.value ?? null,
          extracted_data: extracted,
          risk_results: { rules: risks, decision },
          recommendation: decision.recommendation,
        })
        .eq("id", row.id);

      return { id: row.id as string };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await supabase.from("analyses").update({ status: "failed", error_message: msg }).eq("id", row.id);
      throw err;
    }
  });
