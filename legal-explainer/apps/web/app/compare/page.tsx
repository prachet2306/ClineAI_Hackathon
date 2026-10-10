// Two independent ingest slots and a bounded comparison request.
"use client";
import { useRef, useState } from "react";
import { DISCLAIMER, type IngestResult, type CompareResult } from "@shared/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RiskBadge } from "@/components/risk-badge";
import { ingestDocument, requestData, jsonBody } from "@/lib/client-api";
import { ComparisonResult } from "@/lib/integration";
import { useSession } from "@/lib/session";
export default function ComparePage() {
  const { language } = useSession();
  const [versions, setVersions] = useState<[IngestResult | null, IngestResult | null]>([null, null]);
  const [comparison, setComparison] = useState<CompareResult | null>(null);
  const [usedMock, setUsedMock] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (busy.current) return;
    busy.current = true; setLoading(true); setError(""); setComparison(null); setUsedMock([]);
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 90_000);
    try { await work(controller.signal); }
    catch (e) { setError(controller.signal.aborted ? "This took too long, please try again." : e instanceof Error ? e.message : "Please try again."); }
    finally { clearTimeout(timer); busy.current = false; setLoading(false); }
  }
  function load(index: 0 | 1, file?: File) {
    return run(async (signal) => {
      setVersions((old) => index === 0 ? [null, old[1]] : [old[0], null]);
      let input: File | string;
      if (file) input = file;
      else {
        const response = await fetch(index === 0 ? "/sample-agreement.txt" : "/sample-agreement-v2.txt", { signal });
        if (!response.ok) throw new Error("Couldn't load the sample. Please try again.");
        input = await response.text();
      }
      const data = await ingestDocument(input, signal);
      setVersions((old) => index === 0 ? [data, old[1]] : [old[0], data]);
    });
  }
  return <main className="mx-auto w-full max-w-3xl space-y-5 p-4 sm:p-6">
    <section className="space-y-2 pt-2 sm:pt-6">
      <h1 className="text-3xl font-semibold tracking-tight">Compare two versions</h1>
      <p className="text-muted-foreground">See exactly what changed before you sign. Load both samples for a quick demo.</p>
    </section>
    <div className="grid gap-4 sm:grid-cols-2">{([0, 1] as const).map((index) => <Card key={index}>
      <CardHeader><CardTitle>Version {index + 1}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <label htmlFor={`version-${index}`} className="block text-sm">Choose PDF or image (up to 10 MB)</label>
        <Input id={`version-${index}`} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" disabled={loading} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void load(index, file); }} />
        <Button className="h-auto min-h-11 w-full whitespace-normal" variant="secondary" disabled={loading} onClick={() => load(index)}>Try sample version {index + 1}</Button>
        {versions[index] && <p role="status" className="text-sm">Ready · {versions[index]?.clauses.length} clauses</p>}
      </CardContent></Card>)}</div>
    <Button className="min-h-11 w-full" disabled={loading || !versions[0] || !versions[1]} onClick={() => run(async (signal) => {
      const data = await requestData("/api/compare", jsonBody({ versionA: versions[0], versionB: versions[1], language }), ComparisonResult, signal);
      setComparison(data.comparison); setUsedMock(data.usedMock);
    })}>{loading ? "Working…" : "Compare"}</Button>
    {loading && <div role="status"><p>Reading and comparing documents…</p><Skeleton className="mt-3 h-32" /></div>}
    {error && <p role="alert" className="rounded-lg border p-3">{error}</p>}
    {usedMock.length > 0 && <p className="rounded-lg border p-3">Demo comparison fallback: these example changes may not describe your uploaded versions.</p>}
    {comparison && <><p>{comparison.summary}</p>{comparison.changes.length === 0 && <p>No changes detected.</p>}{comparison.changes.map((change) => <Card key={change.id}>
      <CardHeader><CardTitle className="capitalize">{change.changeType}</CardTitle><div className="flex flex-wrap gap-2"><RiskBadge risk={change.severity} />{change.changeType === "hardened" && <Badge variant="outline">Potential silent change</Badge>}</div></CardHeader>
      <CardContent className="space-y-3 text-sm"><p>Favors: {change.favors.replaceAll("_", " ")}</p><p>{change.explanation}</p><p>{change.whyItMatters}</p>{change.beforeText && <p className="break-words whitespace-pre-wrap"><strong>Before: </strong>{change.beforeText}</p>}{change.afterText && <p className="break-words whitespace-pre-wrap"><strong>After: </strong>{change.afterText}</p>}</CardContent>
    </Card>)}</>}
    <p className="text-sm text-muted-foreground">{DISCLAIMER}</p>
  </main>;
}
