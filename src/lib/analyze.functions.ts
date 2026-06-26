import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";

type Confidence = "high" | "low" | "missing";

interface FieldValue {
  value: number | null;
  confidence: Confidence;
  note?: string;
}

interface Extracted {
  property_name: FieldValue & { value: string | null };
  units: FieldValue;
  purchase_price: FieldValue;
  gross_income: FieldValue;
  operating_expenses: FieldValue;
  noi: FieldValue;
  annual_debt_service: FieldValue;
  occupancy_pct: FieldValue;
  avg_actual_rent: FieldValue;
  avg_market_rent: FieldValue;
  cap_rate_pct: FieldValue;
  estimated_repair_cost: FieldValue;
}

const EXTRACT_PROMPT = `You are a multifamily real-estate underwriter. Read the attached Offering Memorandum (OM) PDF and extract the following fields. For every field, also rate confidence as "high" (clearly stated in the doc), "low" (inferred or partially stated), or "missing" (not findable). Do NOT guess. If you can't find a number, return null with confidence "missing".

Return STRICT JSON matching this schema (no markdown, no prose):

{
  "property_name": {"value": string|null, "confidence": "high"|"low"|"missing"},
  "units": {"value": number|null, "confidence": "..."},
  "purchase_price": {"value": number|null, "confidence": "..."},
  "gross_income": {"value": number|null, "confidence": "..."},
  "operating_expenses": {"value": number|null, "confidence": "..."},
  "noi": {"value": number|null, "confidence": "..."},
  "annual_debt_service": {"value": number|null, "confidence": "...", "note": "if assumed from a loan-quote / proforma, say so"},
  "occupancy_pct": {"value": number|null, "confidence": "..."},
  "avg_actual_rent": {"value": number|null, "confidence": "...", "note": "monthly avg in-place rent"},
  "avg_market_rent": {"value": number|null, "confidence": "...", "note": "monthly avg market/proforma rent"},
  "cap_rate_pct": {"value": number|null, "confidence": "..."},
  "estimated_repair_cost": {"value": number|null, "confidence": "...", "note": "deferred maintenance + value-add capex"}
}

All money in USD whole dollars. Occupancy and cap rate as percentage numbers (e.g. 92.5, not 0.925).`;

interface RiskResult {
  id: string;
  label: string;
  status: "pass" | "caution" | "fail" | "needs_manual_review";
  detail: string;
  metric?: string;
  threshold?: string;
}

function evalRisks(d: Extracted): RiskResult[] {
  const results: RiskResult[] = [];
  const ok = (f: FieldValue | undefined) => f && f.value !== null && f.confidence !== "missing";

  // 1. DSCR
  if (ok(d.noi) && ok(d.annual_debt_service) && (d.annual_debt_service.value as number) > 0) {
    const dscr = (d.noi.value as number) / (d.annual_debt_service.value as number);
    const status = dscr >= 1.25 ? "pass" : dscr >= 1.15 ? "caution" : "fail";
    results.push({
      id: "dscr",
      label: "Debt Service Coverage Ratio",
      status,
      metric: dscr.toFixed(2) + "x",
      threshold: "≥ 1.25x pass · 1.15–1.25x caution · < 1.15x fail",
      detail: `NOI of ${fmtMoney(d.noi.value as number)} against annual debt service of ${fmtMoney(d.annual_debt_service.value as number)}.`,
    });
  } else {
    results.push({
      id: "dscr",
      label: "Debt Service Coverage Ratio",
      status: "needs_manual_review",
      threshold: "≥ 1.25x",
      detail: "NOI or annual debt service could not be confidently extracted.",
    });
  }

  // 2. Occupancy
  if (ok(d.occupancy_pct)) {
    const occ = d.occupancy_pct.value as number;
    const status = occ >= 90 ? "pass" : occ >= 85 ? "caution" : "fail";
    results.push({
      id: "occupancy",
      label: "Occupancy",
      status,
      metric: occ.toFixed(1) + "%",
      threshold: "≥ 90% pass · 85–90% caution · < 85% fail",
      detail: `Reported occupancy at ${occ.toFixed(1)}%.`,
    });
  } else {
    results.push({ id: "occupancy", label: "Occupancy", status: "needs_manual_review", threshold: "≥ 90%", detail: "Occupancy not confidently stated in OM." });
  }

  // 3. Cap rate
  if (ok(d.cap_rate_pct)) {
    const cap = d.cap_rate_pct.value as number;
    const status = cap >= 6 ? "pass" : cap >= 5 ? "caution" : "fail";
    results.push({
      id: "cap_rate",
      label: "Going-in Cap Rate",
      status,
      metric: cap.toFixed(2) + "%",
      threshold: "≥ 6% pass · 5–6% caution · < 5% fail",
      detail: `Cap rate at the listed purchase price.`,
    });
  } else {
    results.push({ id: "cap_rate", label: "Going-in Cap Rate", status: "needs_manual_review", threshold: "≥ 6%", detail: "Cap rate not confidently stated." });
  }

  // 4. Repair cost burden
  if (ok(d.estimated_repair_cost) && ok(d.purchase_price) && (d.purchase_price.value as number) > 0) {
    const ratio = ((d.estimated_repair_cost.value as number) / (d.purchase_price.value as number)) * 100;
    const status = ratio <= 5 ? "pass" : ratio <= 10 ? "caution" : "fail";
    results.push({
      id: "repair_burden",
      label: "Repair Cost vs. Purchase Price",
      status,
      metric: ratio.toFixed(1) + "%",
      threshold: "≤ 5% pass · 5–10% caution · > 10% fail",
      detail: `Repair budget ${fmtMoney(d.estimated_repair_cost.value as number)} against price ${fmtMoney(d.purchase_price.value as number)}.`,
    });
  } else {
    results.push({ id: "repair_burden", label: "Repair Cost vs. Purchase Price", status: "needs_manual_review", threshold: "≤ 5%", detail: "Repair budget or purchase price not confidently stated." });
  }

  // 5. Rent gap (in-place vs market)
  if (ok(d.avg_actual_rent) && ok(d.avg_market_rent) && (d.avg_market_rent.value as number) > 0) {
    const gap = (((d.avg_market_rent.value as number) - (d.avg_actual_rent.value as number)) / (d.avg_market_rent.value as number)) * 100;
    // a small or moderate loss-to-lease is fine; a huge gap implies optimistic proforma
    const abs = Math.abs(gap);
    const status = abs <= 5 ? "pass" : abs <= 15 ? "caution" : "fail";
    results.push({
      id: "rent_gap",
      label: "In-place Rent vs Market Rent",
      status,
      metric: gap.toFixed(1) + "% gap",
      threshold: "≤ 5% pass · 5–15% caution · > 15% fail",
      detail: `Actual rent ${fmtMoney(d.avg_actual_rent.value as number)}/mo vs market ${fmtMoney(d.avg_market_rent.value as number)}/mo.`,
    });
  } else {
    results.push({ id: "rent_gap", label: "In-place Rent vs Market Rent", status: "needs_manual_review", threshold: "within 5%", detail: "Rent roll or market comps not confidently stated." });
  }

  return results;
}

function fmtMoney(n: number): string {
  return "$" + Math.round(n).toLocaleString();
}

function decideRecommendation(rs: RiskResult[]): { recommendation: "pursue" | "pursue_with_conditions" | "pass"; reason: string } {
  const fails = rs.filter((r) => r.status === "fail");
  const cautions = rs.filter((r) => r.status === "caution");
  const reviews = rs.filter((r) => r.status === "needs_manual_review");

  if (fails.length >= 2) return { recommendation: "pass", reason: `${fails.length} risk rules failed outright.` };
  if (fails.length === 1) return { recommendation: "pass", reason: `${fails[0].label} failed — material downside risk.` };
  if (cautions.length + reviews.length === 0) return { recommendation: "pursue", reason: "All risk rules cleared." };
  return {
    recommendation: "pursue_with_conditions",
    reason: `${cautions.length} caution${cautions.length === 1 ? "" : "s"} and ${reviews.length} item${reviews.length === 1 ? "" : "s"} needing manual review.`,
  };
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
