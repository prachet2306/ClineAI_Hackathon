// Optional shadcn chat drawer. Plain text rendering, no storage or document logging.
"use client";
import { useEffect, useRef, useState } from "react";
import { ChatResponseSchema, type IngestResult, type Report } from "@shared/schemas";
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { jsonBody, requestData } from "@/lib/client-api";
export function ChatDrawer({ report, ingest }: { report: Report; ingest: IngestResult }) {
  const [available, setAvailable] = useState(false);
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<{ role: string; text: string }[]>([]);
  const [sessionId, setSessionId] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20_000);
    void fetch("/api/chat", { signal: controller.signal }).then((r) => r.json()).then((body) => setAvailable(body.available === true)).catch(() => {}).finally(() => clearTimeout(timer));
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);
  if (!available) return null;
  async function send() {
    if (busy.current || !message.trim()) return;
    busy.current = true; setLoading(true); setError("");
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 90_000);
    const question = message.trim();
    try {
      const result = await requestData("/api/chat", jsonBody({ sessionId, documentId: ingest.documentId,
        language: report.language, message: question, report, ingest }), ChatResponseSchema, controller.signal);
      setSessionId(result.sessionId); setHistory((old) => [...old, { role: "You", text: question }, { role: "Assistant", text: result.answer }]); setMessage("");
    } catch { setError("Chat couldn't finish. Please try again; a new conversation will start."); setSessionId(undefined); }
    finally { clearTimeout(timer); busy.current = false; setLoading(false); }
  }
  return <Sheet><SheetTrigger render={<Button variant="outline" />}>Ask about this document</SheetTrigger>
    <SheetContent className="w-full! sm:max-w-lg!">
      <SheetHeader><SheetTitle>Ask your document</SheetTitle><SheetDescription>Issues to review, not legal advice. History lasts for this session.</SheetDescription></SheetHeader>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4" aria-live="polite">
        {history.map((item, index) => <div key={index} className="rounded-lg bg-muted p-3"><p className="font-medium">{item.role}</p><p className="break-words whitespace-pre-wrap">{item.text}</p></div>)}
        {loading && <Skeleton className="h-20 w-full" />}{error && <p role="alert">{error}</p>}
      </div>
      <form className="space-y-3 p-4" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <label className="text-sm" htmlFor="chat-question">Your question</label><Textarea id="chat-question" value={message} maxLength={4000} disabled={loading} onChange={(e) => setMessage(e.target.value)} placeholder="What should I ask about the deposit?" />
        <Button type="submit" disabled={loading || !message.trim()} className="min-h-11 w-full">{loading ? "Thinking…" : "Send"}</Button>
      </form>
    </SheetContent></Sheet>;
}
