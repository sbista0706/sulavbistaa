import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { triggerAnalysis } from "@/lib/analyze.functions";
import { Upload, FileText, Loader2, AlertCircle, Sparkles } from "lucide-react";

export const Route = createFileRoute("/upload")({
  head: () => ({
    meta: [
      { title: "Upload OM — Property Pulse Check" },
      { name: "description", content: "Upload a commercial real-estate Offering Memorandum PDF to run an automated risk screen." },
    ],
  }),
  component: UploadPage,
});

const MAX_MB = 50;

type Phase = "idle" | "uploading" | "error";

function UploadPage() {
  const trigger = useServerFn(triggerAnalysis);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const onPick = (f: File | null) => {
    setError(null);
    if (!f) return;
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
      setError("Please upload a PDF file.");
      return;
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      setError(`File is over ${MAX_MB} MB. Try a smaller PDF.`);
      return;
    }
    setFile(f);
  };

  const onSubmit = async () => {
    if (!file) return;
    setPhase("uploading");
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) throw new Error("No session yet — refresh the page and try again.");

      const propertyGuess = file.name.replace(/\.pdf$/i, "").trim() || file.name;

      // 1. Create the pending row (RLS scopes it to this user).
      const { data: row, error: insErr } = await supabase
        .from("analyses")
        .insert({ file_name: file.name, property_name: propertyGuess, status: "pending" })
        .select("id")
        .single();
      if (insErr || !row) throw new Error(insErr?.message ?? "Could not create the screening record.");

      // 2. Upload the OM to owner-scoped Storage: oms/{user}/{id}/{file}
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${userId}/${row.id}/${safeName}`;
      const { error: upErr } = await supabase.storage
        .from("oms")
        .upload(storagePath, file, { contentType: file.type || "application/pdf", upsert: true });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

      // 3. Record the path on the row.
      await supabase.from("analyses").update({ storage_path: storagePath }).eq("id", row.id);

      // 4. Fire the n8n pipeline (no-op if not configured yet — deal stays pending).
      await trigger({ data: { analysis_id: row.id, storage_path: storagePath } });

      // 5. Go to the deal; Realtime updates it as n8n works.
      navigate({ to: "/analysis/$id", params: { id: row.id } });
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "Something went wrong starting the screen.");
    }
  };

  const busy = phase === "uploading";

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Step 1 of 1</p>
      <h1 className="font-script mt-2 text-6xl">Screen a new deal</h1>
      <p className="mt-3 max-w-xl text-sm text-muted-foreground">
        Drop in the full Offering Memorandum PDF, any commercial type. Property Pulse Check detects the property type,
        extracts the metrics, and runs the risk screen automatically.
      </p>

      <div className="mt-8">
        <label
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            onPick(e.dataTransfer.files?.[0] ?? null);
          }}
          className={`block cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition ${
            dragOver ? "border-primary bg-primary/5" : "border-border-strong bg-surface hover:bg-secondary/50"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(e) => onPick(e.target.files?.[0] ?? null)}
            disabled={busy}
          />
          {!file ? (
            <>
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
                <Upload className="h-5 w-5 text-primary" />
              </div>
              <div className="mt-4 font-medium">Drop OM PDF here or click to browse</div>
              <div className="mt-1 text-xs text-muted-foreground">PDF only · up to {MAX_MB} MB</div>
            </>
          ) : (
            <div className="flex items-center justify-center gap-3 text-left">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-secondary">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="truncate font-medium">{file.name}</div>
                <div className="text-xs text-muted-foreground tabular">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
              </div>
            </div>
          )}
        </label>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => { setFile(null); setError(null); setPhase("idle"); if (inputRef.current) inputRef.current.value = ""; }}
            disabled={busy || !file}
            className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-50"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!file || busy}
            className="inline-flex min-w-[200px] items-center justify-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? (<><Loader2 className="h-4 w-4 animate-spin" /> Uploading…</>) : (<><Sparkles className="h-4 w-4" /> Run risk screen</>)}
          </button>
        </div>
      </div>

      <div className="mt-12 card-base p-6">
        <h2 className="text-sm font-semibold">How it works</h2>
        <ol className="mt-4 space-y-3 text-sm">
          <Step n={1} label="Detect the property type" detail="The model reads the OM and classifies it (multifamily, hotel, office, retail, industrial, mixed-use). You can correct it on the deal page." />
          <Step n={2} label="Extract the metrics" detail="A universal core (NOI, cap rate, DSCR, occupancy, price) plus type-specific metrics (RevPAR/ADR, WALT, rent roll …)." />
          <Step n={3} label="Run the risk screen" detail="Per-type rules with thresholds you can tune in Settings. Pass or pass-with-conditions get an Agent report; failures are kept and badged Excluded." />
        </ol>
        <p className="mt-5 rounded-md border border-info/20 bg-info/5 p-3 text-xs text-info">
          Anything that can't be extracted with confidence is flagged for manual review rather than guessed.
        </p>
      </div>
    </div>
  );
}

interface StepProps {
  n: number;
  label: string;
  detail: string;
}

function Step({ n, label, detail }: StepProps) {
  return (
    <li className="flex gap-3">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{n}</span>
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-muted-foreground text-xs mt-0.5">{detail}</div>
      </div>
    </li>
  );
}
