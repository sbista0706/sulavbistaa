# Ledger ⇄ n8n contract (Phase 1)

The app is a skin. It uploads the OM, creates a `pending` row, and pings n8n.
**n8n owns all processing** and writes results back to Supabase; the UI follows
via Realtime. This document is the stable contract — build/verify the n8n
workflow against it. `ledger-analyze.workflow.json` is an importable skeleton.

---

## 1. Trigger (app → n8n)

`POST {N8N_WEBHOOK_URL}` with header `x-webhook-secret: {N8N_WEBHOOK_SECRET}`.

```json
{
  "analysis_id": "uuid",
  "bucket": "oms",
  "storage_path": "{user_id}/{analysis_id}/{filename}.pdf",
  "user_id": "uuid"
}
```

First node should reject the request if `x-webhook-secret` ≠ the configured secret.

## 2. Credentials n8n needs (you add these)

- **Supabase service-role key** — server-side only; bypasses RLS for read-back of
  `risk_settings` and write-back to `analyses` + the `reports` bucket (Phase 2).
- **OpenRouter API key** — `Authorization: Bearer {OPENROUTER_API_KEY}`.
- `SUPABASE_URL` (e.g. `https://{project}.supabase.co`).

## 3. Pipeline steps

1. **Verify secret** (IF). Reject on mismatch.
2. **Mark processing** — PATCH the row `status = "processing"` (see §5 for the call shape).
3. **Download the OM** — `GET {SUPABASE_URL}/storage/v1/object/{bucket}/{storage_path}`
   with `Authorization: Bearer {service_role}` and `apikey: {service_role}`. Response = the PDF binary.
4. **Extract text** — *Extract From File* node (PDF → text).
   **OCR fallback:** if the extracted text is empty/near-empty (scanned PDF),
   send the PDF to a **vision-capable** free model instead of the text model
   (the recommended primary model below already handles this).
5. **Extract metrics** — one OpenRouter call (§4). Returns the structured JSON.
6. **Score risk** — Code node. Read thresholds for the detected family from
   `risk_settings` (fall back to defaults in §6), evaluate the rules, derive the
   decision (§7).
7. **(Phase 2)** if not excluded → generate report text + PDF → upload to
   `reports/{user_id}/{analysis_id}/report.pdf` → set `report_path`/`report_text`.
8. **Write back** — PATCH the row with the full result (§5) and final `status`.
9. **On any error** — PATCH `status = "failed"`, `error_message = "<message>"`.

## 4. OpenRouter extraction call

`POST https://openrouter.ai/api/v1/chat/completions`

- **Recommended model (primary):** `google/gemini-2.0-flash-exp:free` — large
  context + vision (handles both born-digital text and scanned pages), good for
  the OCR fallback. **Text-only fallback:** `meta-llama/llama-3.3-70b-instruct:free`.
  Free model availability changes — this is a single node setting, swap freely.
- `response_format: { "type": "json_object" }`.
- For very long OMs, chunk the text and extract section-wise, or pass the most
  relevant sections (financials/rent roll/debt) — free context limits vary.

**System/user prompt (essence):** "You are a CRE underwriting analyst. From the
OM text, return ONLY JSON matching this schema. Use null for anything not stated;
never guess. For each metric also give a confidence of high|low|missing."

**Required output JSON:**

```json
{
  "property_name": "string|null",
  "location": "string|null",
  "property_subtype": "multifamily|sfr|hotel|office|retail|industrial|mixed_use",
  "metrics": {
    "purchase_price": null, "price_per_unit": null, "gross_income": null,
    "operating_expenses": null, "noi": null, "noi_margin_pct": null,
    "cap_rate_pct": null, "market_cap_rate_pct": null, "occupancy_pct": null,
    "annual_debt_service": null, "dscr": null, "loan_amount": null,
    "ltv_pct": null, "expense_ratio_pct": null, "year_built": null
  },
  "type_metrics": { "...": "per-type keys, see §8" },
  "confidence": { "noi": "high|low|missing", "...": "per metric key" }
}
```

`property_subtype` maps to a family: residential_income (multifamily, sfr),
hospitality (hotel), commercial_leased (office, retail), industrial_mixed
(industrial, mixed_use).

## 5. Write-back (n8n → Supabase)

`PATCH {SUPABASE_URL}/rest/v1/analyses?id=eq.{analysis_id}`
Headers: `apikey: {service_role}`, `Authorization: Bearer {service_role}`,
`Content-Type: application/json`, `Prefer: return=minimal`.

```json
{
  "status": "complete | excluded | failed",
  "property_type": "residential_income|hospitality|commercial_leased|industrial_mixed",
  "property_subtype": "multifamily|...",
  "location": "string|null",
  "metrics": { "...": "universal core, numbers or null" },
  "type_metrics": { "...": "per-type, numbers or null" },
  "risk_results": {
    "rules": [
      { "id": "dscr", "label": "Debt service coverage",
        "status": "pass|review|high|critical", "value": 1.18,
        "threshold": "DSCR >= 1.25", "note": "Below the 1.25 minimum." }
    ],
    "decision": { "recommendation": "pursue|pursue_with_conditions|pass",
                  "reason": "one-sentence summary" }
  },
  "verify_items": [{ "field": "noi", "reason": "low-confidence extraction" }],
  "confidence": { "noi": "high", "...": "per metric" },
  "report_text": "markdown report (see §9)",
  "report_path": "{user_id}/{analysis_id}/report.pdf"
}
```

`report_path` is the object key **relative to the `reports` bucket** (no bucket
prefix) — the app calls `storage.from('reports').createSignedUrl(report_path)`.

To read thresholds:
`GET {SUPABASE_URL}/rest/v1/risk_settings?user_id=eq.{user_id}&property_type=eq.{family}`
(service-role). If none, use the defaults in §6.

## 6. Default thresholds (mirror of the app's taxonomy)

```
residential_income: dscr{min:1.25,critical_min:1.20} occupancy{min_pct:90}
                    expense_ratio{max_pct:55} cap_vs_market{max_bps_below:75}
                    deferred_capex{max_pct_of_price:5}
hospitality:        dscr{min:1.40,critical_min:1.30} occupancy{min_pct:60}
                    gop_margin{min_pct:30} revpar_vs_comp{max_pct_below:15}
                    pip_funded{required:1}
commercial_leased:  dscr{min:1.30,critical_min:1.20} walt{min_years:4}
                    tenant_conc{max_top_tenant_pct:30} rollover{max_near_term_pct:20}
                    occupancy{min_pct:85}
industrial_mixed:   dscr{min:1.30,critical_min:1.20} walt{min_years:4}
                    occupancy{min_pct:85} tenant_conc{max_top_tenant_pct:40}
                    deferred_capex{max_pct_of_price:5}
```

## 7. Decision logic

Per rule, set `status`:
- `critical` if the value breaches the critical bound (e.g. DSCR < critical_min).
- `high` if it breaches the standard bound (e.g. DSCR < min).
- `review` if the value is null/low-confidence (couldn't be evaluated).
- `pass` otherwise.

Then:
- any `critical` → `recommendation = "pass"`, `status = "excluded"` (no report).
- else any `high` or `review` → `recommendation = "pursue_with_conditions"`, `status = "complete"`.
- else → `recommendation = "pursue"`, `status = "complete"`.

## 8. Per-type metric keys (`type_metrics`)

```
residential_income: units, avg_in_place_rent, avg_market_rent, loss_to_lease_pct,
                    rent_per_sqft, concessions_pct, value_add_capex
hospitality:        keys, adr, revpar, gop_margin_pct, brand, pip_cost, fnb_revenue_pct
commercial_leased:  nra_sqft, walt_years, in_place_rent_psf, market_rent_psf,
                    lease_type, top_tenant_pct, near_term_rollover_pct, ti_lc
industrial_mixed:   nra_sqft, clear_height_ft, dock_doors, rent_psf, walt_years, tenant_count
```

The app renders exactly these keys via `src/lib/screening/taxonomy.ts` — keep them in sync.

## 9. Agent report + PDF (Phase 2)

Only for non-excluded deals (`recommendation` ≠ `pass`). Excluded deals skip
this and write back with no report.

**9a. Generate report text** — a second OpenRouter call.
Prompt (essence): "You are a CRE analyst. Using this deal JSON (metrics, type
metrics, risk results), write a concise institutional screening memo in
**Markdown** with these sections, in order:
- `# Summary` — 2–3 sentences ending with the recommendation.
- `## Property` — plain-English description (type, size, location, vintage).
- `## Key metrics` — bullets of the decision-relevant numbers.
- `## Risk screen` — one line per rule: name — pass/flag — value vs threshold.
- `## Investor verdict` — **WHO should buy and WHY**: name the buyer profile
  (core / core-plus / value-add / opportunistic), the one-sentence investment
  thesis, the return driver, and the single condition that would change the call.
- `## Items to verify` — the verify_items (or 'None').
Plain English, no fabricated numbers — only what's in the JSON."
Take `report_text = choices[0].message.content` (Markdown).

(The `## Investor verdict` section directly targets the rubric's "clear market
verdict — who should buy and why.")

**9b. Build HTML** — Code node (`n8n/report-html.js`) turns `report_text` +
header into a styled standalone HTML document (string on `html`).

**9c. HTML → PDF.** Recommended: **Gotenberg** (free, self-hostable). Send the
HTML as multipart to `POST {GOTENBERG_URL}/forms/chromium/convert/html` with a
file part named `index.html`; response is the PDF binary.
Alternatives: the `n8n-nodes-puppeteer` community node, or a free HTML-to-PDF API.

**9d. Upload to Storage** — `POST {SUPABASE_URL}/storage/v1/object/reports/{user_id}/{analysis_id}/report.pdf`
with `Authorization: Bearer {service_role}`, `apikey: {service_role}`,
`Content-Type: application/pdf`, body = the PDF binary. (Use `x-upsert: true` to overwrite.)

**9e. Attach + write back** — add to the patch (§5): `report_text` and
`report_path = "{user_id}/{analysis_id}/report.pdf"` (bucket-relative), then PATCH
the row as usual. The app's "Download PDF" button signs this path on demand.
