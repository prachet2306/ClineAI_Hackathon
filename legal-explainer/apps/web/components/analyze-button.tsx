// Analyze action with a bounded request, skeleton and recoverable errors.
"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession, setSession } from "@/lib/session";
import { analyzeDocument } from "@/lib/client-api";
export function AnalyzeButton() {
  const { result, language } = useSession();
  const router = useRouter();
  const busy = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function analyze() {
    if (busy.current || !result) return;
    busy.current = true; setLoading(true); setError(""); setSession({ report: null, usedMock: [] });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    try { await analyzeDocument(result, language, controller.signal); router.push("/report"); }
    catch { setError(controller.signal.aborted ? "This took too long, please try again." : "Couldn't build the report. Please try again."); }
    finally { clearTimeout(timer); busy.current = false; setLoading(false); }
  }
  return <div className="space-y-3">
    <Button className="min-h-11 w-full" disabled={loading || !result} onClick={analyze}>{loading ? "Preparing your report…" : "Analyze"}</Button>
    {loading && <div role="status"><p className="text-sm">Checking clauses and sources…</p><Skeleton className="mt-2 h-20 w-full" /></div>}
    {error && <p role="alert" className="text-sm">{error}</p>}
  </div>;
}
