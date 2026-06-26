import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { analyzeOM } from "@/lib/analyze.functions";
import { Upload, FileText, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/upload")({
  head: () => ({
    meta: [
      { title: "Upload OM — Ledger" },
      { name: "description", content: "Upload a multifamily Offering Memorandum PDF to run a 5-rule risk screen." },
    ],
  }),
  component: UploadPage,
});

function UploadPage() {
  const analyze = useServerFn(analyzeOM);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [phase, setPhase] = useState<"idle" | "reading" | "analyzing" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const onPick = (f: File | null) => {
    setError(null);
    if (!f) return;
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
      setError("Please upload a PDF file.");
      return;
    }
    if (f.size > 25 * 1024 * 1024) {
      setError("File is over 25 MB. Try a smaller PDF.");
      return;
    }
    setFile(f);
  };

  const onSubmit = async () => {
    if (!file) return;
    setPhase("reading");
    setError(null);
    try {
      const base64 = await fileToBase64(file);
      setPhase("analyzing");
      const result = await analyze({
        data: {
          file_name: file.name,
          file_base64: base64,
          mime_type: file.type || "application/pdf",
        },
      });
      navigate({ to: "/analysis/$id", params: { id: result.id } });
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "Something went wrong analyzing the OM.");
    }
  };

  const busy = phase === "reading" || phase === "analyzing";

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Step 1 of 1</p>
      <h1 className="font-display mt-2 text-5xl">Screen a new deal</h1>
      <p className="mt-3 max-w-xl text-sm text-muted-foreground">
        Drop in the full Offering Memorandum PDF. Ledger reads the income, expense, debt, occupancy, rent roll and repair numbers, then evaluates five risk rules.
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
              <div className="mt-1 text-xs text-muted-foreground">PDF only · up to 25 MB</div>
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
            {phase === "reading" && (<><Loader2 className="h-4 w-4 animate-spin" /> Reading PDF…</>)}
            {phase === "analyzing" && (<><Loader2 className="h-4 w-4 animate-spin" /> Running risk screen…</>)}
            {(phase === "idle" || phase === "error") && (<>Run risk screen</>)}
          </button>
        </div>
      </div>

      <div className="mt-12 card-base p-6">
        <h2 className="text-sm font-semibold">What Ledger checks</h2>
        <ul className="mt-4 space-y-3 text-sm">
          <RuleHint label="Debt Service Coverage" detail="NOI ÷ annual debt service. Caution under 1.25x, fail under 1.15x." />
          <RuleHint label="Occupancy" detail="Pass at 90%+, caution 85–90%, fail under 85%." />
          <RuleHint label="Going-in Cap Rate" detail="Pass at 6%+, caution 5–6%, fail under 5%." />
          <RuleHint label="Repair burden" detail="Estimated repair / capex cost as a share of purchase price." />
          <RuleHint label="Rent gap" detail="In-place rent vs market rent. Large gaps imply an optimistic proforma." />
        </ul>
        <p className="mt-5 rounded-md border border-info/20 bg-info/5 p-3 text-xs text-info">
          If any number can't be extracted with confidence, Ledger marks that rule <span className="font-semibold">needs manual review</span> rather than guessing.
        </p>
      </div>
    </div>
  );
}

function RuleHint({ label, detail }: { label: string; detail: string }) {
  return (
    <li className="flex gap-3">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-muted-foreground text-xs mt-0.5">{detail}</div>
      </div>
    </li>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
