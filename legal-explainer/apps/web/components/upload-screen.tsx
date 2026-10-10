"use client";
// Upload screen: file drop zone, pasted text, language select, and the "Check" / "Sample" buttons.
// Calls POST /api/ingest (multipart for a file, JSON {text} for pasted text or the sample) and shows the result.
// Document text is only ever sent to /api/ingest; nothing is logged or stored in browser storage.
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { IngestPreview } from "@/components/ingest-preview";
import { IngestResultSchema, LANGUAGES, type IngestResult, type Language } from "@/lib/shared";
import { setSession, useSession } from "@/lib/session";

const LANGUAGE_LABELS: Record<Language, string> = {
  en: "English",
  hi: "Hindi",
  as: "Assamese",
  bn: "Bengali",
  ta: "Tamil",
  te: "Telugu",
  mr: "Marathi",
};
const LANGUAGE_ITEMS = LANGUAGES.map((code) => ({ value: code, label: LANGUAGE_LABELS[code] }));

const ALLOWED_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".webp"];
const ACCEPT = ALLOWED_EXTENSIONS.join(",");
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const GENERIC_ERROR = "Something went wrong while reading your document. Please try again, or try the sample agreement.";
const TIMEOUT_ERROR = "This took too long, please try again.";
const REQUEST_TIMEOUT_MS = 90_000;

type Status = "idle" | "loading" | "error";

function checkFile(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return "That file type isn't supported. Please choose a PDF, PNG, JPG or WEBP file.";
  }
  if (file.size > MAX_BYTES) return "That file is too large. Please choose a file under 10 MB.";
  if (file.size === 0) return "That file looks empty. Please choose another one.";
  return null;
}

/** Sends the request and returns the validated ingest result, or throws an Error with a user-friendly message. */
async function callIngest(init: RequestInit, signal: AbortSignal): Promise<IngestResult> {
  let response: Response;
  try {
    response = await fetch("/api/ingest", { method: "POST", ...init, signal });
  } catch {
    throw new Error(signal.aborted ? TIMEOUT_ERROR : "We couldn't reach the server. Check your connection and try again.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(signal.aborted ? TIMEOUT_ERROR : GENERIC_ERROR);
  }

  const envelope = body as { ok?: unknown; data?: unknown; error?: { message?: unknown } } | null;
  if (!envelope || envelope.ok !== true) {
    const message = envelope?.error?.message;
    throw new Error(typeof message === "string" && message ? message : GENERIC_ERROR);
  }

  const parsed = IngestResultSchema.safeParse(envelope.data);
  if (!parsed.success) throw new Error(GENERIC_ERROR);
  return parsed.data;
}

export function UploadScreen() {
  const { result, language } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = useRef(false); // true while a request is in flight (blocks double submits)

  const loading = status === "loading";

  function fail(message: string) {
    setStatus("error");
    setError(message);
  }

  function chooseFile(next: File | null) {
    if (!next) return;
    const problem = checkFile(next);
    if (problem) {
      setFile(null);
      fail(problem);
      return;
    }
    setFile(next);
    setStatus("idle");
    setError(null);
  }

  function clearFile() {
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  /** One guarded request: ignored while another runs, aborted after 90 s, and loading is always reset in `finally`. */
  async function run(buildInit: (signal: AbortSignal) => Promise<RequestInit>) {
    if (busy.current) return;
    busy.current = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    setStatus("loading");
    setError(null);
    setSession({ result: null });
    try {
      const init = await buildInit(controller.signal);
      const data = await callIngest(init, controller.signal);
      setSession({ result: data });
      setStatus("idle");
    } catch (e) {
      fail(controller.signal.aborted ? TIMEOUT_ERROR : e instanceof Error ? e.message : GENERIC_ERROR);
    } finally {
      clearTimeout(timer);
      busy.current = false;
      setStatus((s) => (s === "loading" ? "idle" : s));
    }
  }

  async function handleCheck() {
    if (busy.current) return;
    if (file) {
      const problem = checkFile(file);
      if (problem) return fail(problem);
      const form = new FormData();
      form.append("file", file); // the file wins: pasted text is not sent
      return run(async () => ({ body: form }));
    }
    if (text.trim()) {
      return run(async () => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }));
    }
    fail("Choose a file or paste some text first.");
  }

  async function handleSample() {
    return run(async (signal) => {
      let sample: string;
      try {
        const response = await fetch("/sample-agreement.txt", { signal });
        if (!response.ok) throw new Error("sample missing");
        sample = await response.text();
      } catch {
        throw new Error(signal.aborted ? TIMEOUT_ERROR : "We couldn't load the sample agreement. Please try again.");
      }
      return {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sample, filename: "sample-agreement.txt" }),
      };
    });
  }

  function handleDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    if (loading) return;
    chooseFile(event.dataTransfer.files?.[0] ?? null);
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Your document</CardTitle>
          <CardDescription>Upload a file or paste the text. PDF, PNG, JPG or WEBP, up to 10 MB.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label
            htmlFor="file-input"
            onDragOver={(e) => {
              e.preventDefault();
              if (!loading) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`flex min-h-32 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-4 text-center text-sm transition-colors focus-within:ring-3 focus-within:ring-ring/50 ${
              dragging ? "border-primary bg-primary/5" : "border-input hover:bg-muted/50"
            }`}
          >
            <span className="font-medium">Drag and drop a file here, or tap to choose</span>
            <span className="text-xs text-muted-foreground">PDF, PNG, JPG, JPEG or WEBP</span>
            <input
              ref={inputRef}
              id="file-input"
              type="file"
              accept={ACCEPT}
              className="sr-only"
              disabled={loading}
              onChange={(e) => {
                chooseFile(e.target.files?.[0] ?? null);
                e.target.value = ""; // allow choosing the same file again
              }}
            />
          </label>

          {file && (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 p-2 text-sm">
              <span className="min-w-0 break-all">Chosen file: {file.name}</span>
              <Button type="button" variant="ghost" size="sm" onClick={clearFile} disabled={loading}>
                Remove
              </Button>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label htmlFor="paste-text" className="text-sm font-medium">
              Or paste the text
            </label>
            <Textarea
              id="paste-text"
              rows={5}
              placeholder="Paste the agreement text here"
              value={text}
              disabled={loading}
              onChange={(e) => setText(e.target.value)}
            />
            {file && text.trim() && (
              <p className="text-xs text-muted-foreground">
                You chose a file and pasted text. The file will be used; the pasted text will be ignored.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="language" className="text-sm font-medium">
              Language for your report
            </label>
            <Select
              items={LANGUAGE_ITEMS}
              value={language}
              onValueChange={(value) => {
                const next = LANGUAGES.find((code) => code === value);
                if (next) setSession({ language: next });
              }}
              disabled={loading}
            >
              <SelectTrigger id="language" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGE_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Button type="button" size="lg" className="w-full" onClick={handleCheck} disabled={loading}>
              {loading ? "Reading your document…" : "Check this document"}
            </Button>
            <Button type="button" size="lg" variant="secondary" className="w-full" onClick={handleSample} disabled={loading}>
              Try with a sample agreement
            </Button>
          </div>

          {error && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </p>
          )}
          {!error && !loading && !result && !file && !text.trim() && (
            <p className="text-center text-sm text-muted-foreground">
              Nothing chosen yet. Upload a file, paste text, or try the sample agreement.
            </p>
          )}
        </CardContent>
      </Card>

      {loading && (
        <Card aria-busy="true" aria-live="polite">
          <CardHeader>
            <CardTitle>Reading your document…</CardTitle>
            <CardDescription>Scanned files and photos can take around 10 seconds.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </CardContent>
        </Card>
      )}

      {!loading && result && <IngestPreview result={result} />}
    </div>
  );
}
