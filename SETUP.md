# Property Pulse Check — backend setup checklist

The app is a skin over Supabase; all OM processing runs in n8n (OpenRouter +
Gotenberg). Follow these once to wire the live pipeline. Secrets never go in
chat or git — only into `n8n/.env` (gitignored) and the app's env.

Project: `https://smbjgyvkycfzizuwirrx.supabase.co`

---

## A. Supabase

1. **Enable the Data API** — Integrations → Data API → Enable → Save. Confirm the
   exposed schemas include `public`.
2. **Create a secret key for n8n** — API Keys → "Publishable and secret API keys"
   → New secret key → copy the `sb_secret_…` value **straight into `n8n/.env`**
   (do not paste it elsewhere). Legacy JWT keys should stay **disabled**.
3. **Run the migrations** — SQL Editor → paste each file's contents and Run, in order:
   1. `supabase/migrations/20260626181500_secure_analyses_rls.sql`
   2. `supabase/migrations/20260626190000_phase1_metrics_schema.sql`
4. **Enable anonymous sign-ins** — Authentication → Sign In / Providers →
   Anonymous → Enable.
5. **Verify** — Storage shows `oms` + `reports` buckets; Table editor shows
   `risk_settings` and the new `analyses` columns.

## B. n8n + Gotenberg (free, Docker)

1. **OpenRouter key** — https://openrouter.ai/keys → create one (free models need no payment).
2. **Configure env** —
   ```bash
   cd n8n
   cp .env.example .env
   # edit n8n/.env: set N8N_WEBHOOK_SECRET (openssl rand -hex 32),
   #                SUPABASE_SERVICE_ROLE_KEY (sb_secret_…), OPENROUTER_API_KEY
   ```
3. **Start the stack** —
   ```bash
   docker compose up -d      # n8n at :5678, gotenberg at :3000
   ```
4. **Import the workflow** — n8n UI (http://localhost:5678) → Workflows →
   Import from File → `n8n/ledger-analyze.workflow.json`.
5. **Paste the Code-node scripts** —
   - "Score risk"        ← `n8n/risk-and-writeback.js`
   - "Build report HTML" ← `n8n/report-html.js`
   - "Attach report"     ← `n8n/attach-report.js`
6. **Activate** the workflow (toggle, top-right), then open the **Webhook** node
   and copy its **Production URL** (e.g. `http://localhost:5678/webhook/ledger-analyze`).

## C. Connect the app

Set these in the app's env (root `.env` for local dev; Lovable project
settings for the deployed app):

```
N8N_WEBHOOK_URL=<the Webhook Production URL from B6>
N8N_WEBHOOK_SECRET=<same value as in n8n/.env>
```

**Gotcha:** a deployed app can't reach `localhost` n8n. For a live test either
run the app locally (`bun --bun run dev`) against local n8n, or expose n8n with
a tunnel: `cloudflared tunnel --url http://localhost:5678` (use that public URL
as `N8N_WEBHOOK_URL`).

## D. Smoke test

```bash
bun --bun run dev     # or your normal dev command
```
Upload an OM → the deal should move **Queued → Processing → Pursue / Excluded**,
with metrics, a risk screen, and (for passing deals) a downloadable PDF report.

If write-back returns **401**, the new opaque secret key isn't accepted in the
`Authorization` header on some setups — in the n8n "Write back" / "Download OM" /
"Upload report" HTTP nodes, keep the `apikey` header and remove `Authorization`.

Full request/response contract: `n8n/CONTRACT.md`.
