// In-memory report screen: verified quotes/sources, action items and optional PDF/chat.
"use client";
import Link from "next/link";
import { FileTextIcon, LightbulbIcon, ListChecksIcon, ShieldCheckIcon } from "lucide-react";
import { DISCLAIMER } from "@shared/schemas";
import { useSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { RiskBadge } from "@/components/risk-badge";
import { PdfDownload } from "@/components/pdf-download";
import { ChatDrawer } from "@/components/chat-drawer";
export default function ReportPage() {
  const { report, result, usedMock } = useSession();
  if (!report) return <main className="mx-auto w-full max-w-xl space-y-4 p-4 sm:p-6"><Card><CardContent className="flex flex-col items-center gap-3 py-10 text-center"><span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary"><FileTextIcon className="size-6" aria-hidden /></span><h1 className="text-xl font-semibold">No report yet</h1><p className="text-sm text-muted-foreground">Your session is kept only in memory. Upload a document to begin.</p><Link className={buttonVariants({ size: "lg" })} href="/">Back to upload</Link></CardContent></Card><p className="text-center text-xs text-muted-foreground">{DISCLAIMER}</p></main>;
  return <main className="mx-auto w-full max-w-3xl space-y-5 p-4 sm:p-6">
    <Card>
      <CardHeader className="gap-3">
        <p className="flex items-center gap-2 break-all text-xs text-muted-foreground"><FileTextIcon className="size-4 shrink-0" aria-hidden />{report.filename}</p>
        <h1 className="text-2xl font-semibold tracking-tight">Your document review</h1>
        <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-muted-foreground">Overall:</span><RiskBadge risk={report.overallRisk} /></div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-base leading-relaxed">{report.summary}</p>
        <div className="grid grid-cols-3 gap-2 text-center">
          {(["red", "amber", "green"] as const).map((level) => (
            <div key={level} className={`rounded-lg p-2 ${level === "red" ? "bg-red-50 text-red-900" : level === "amber" ? "bg-amber-50 text-amber-900" : "bg-green-50 text-green-900"}`}>
              <p className="text-xl font-semibold">{report.flags.filter((f) => f.riskLevel === level).length}</p>
              <p className="text-xs capitalize">{level}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
    {usedMock.length > 0 && <Card><CardContent className="pt-4"><p role="status">Demo fallback used: {usedMock.join(", ")}. Some output may be in English and is not a complete assessment of this document.</p></CardContent></Card>}
    <div className="flex flex-wrap gap-3"><PdfDownload report={report} />{result && <ChatDrawer report={report} ingest={result} />}</div>
    <p className="flex items-start gap-2 rounded-lg border bg-background p-3 text-sm text-muted-foreground"><ShieldCheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden />{DISCLAIMER}</p>
    {report.flags.length > 0 && <h2 className="pt-2 text-lg font-semibold">Clauses worth reviewing</h2>}
    {!report.flags.length && <p>No flags are available. This does not establish that the document is safe to sign.</p>}
    {report.flags.map((flag, index) => <Card key={`${flag.clauseId}-${index}`}>
      <CardHeader><CardTitle className="capitalize">{flag.category.replaceAll("_", " ")}</CardTitle><div className="flex flex-wrap gap-2"><RiskBadge risk={flag.riskLevel} />{flag.quoteVerified && <Badge variant="outline">Quote checked</Badge>}</div></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>{flag.explanation}</p><p><strong>Why it matters: </strong>{flag.whyItMatters}</p>
        <blockquote className="break-words whitespace-pre-wrap rounded-r-lg border-l-4 border-primary/40 bg-muted/50 py-2 pr-3 pl-3 italic">“{flag.quote}”</blockquote>
        {!flag.quoteVerified && <p>Couldn&apos;t confirm this quote in the document.</p>}
        {flag.grounding === "unverified" ? <p className="text-muted-foreground">Couldn&apos;t verify this point, worth checking with a professional.</p> : flag.citations.map((source) => <div key={source.sourceId} className="rounded-lg bg-muted p-3"><p className="font-medium">PRS summary · {source.title}</p><p>{source.snippet}</p>{source.url && /^https?:\/\//.test(source.url) && <a className="underline" href={source.url} target="_blank" rel="noopener noreferrer">Read source</a>}{source.asOf && <p className="text-xs">As of {source.asOf}</p>}</div>)}
      </CardContent>
    </Card>)}
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><ListChecksIcon className="size-5 text-primary" aria-hidden />Questions to ask before signing</CardTitle></CardHeader><CardContent><ol className="space-y-2">{report.questionsToAsk.map((q, i) => <li key={i} className="flex gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">{i + 1}</span><span>{q}</span></li>)}</ol></CardContent></Card>
    {report.negotiationTips.length > 0 && <Card><CardHeader><CardTitle className="flex items-center gap-2"><LightbulbIcon className="size-5 text-primary" aria-hidden />Negotiation tips</CardTitle></CardHeader><CardContent><ul className="list-disc space-y-2 pl-5">{report.negotiationTips.map((tip, i) => <li key={i}>{tip}</li>)}</ul></CardContent></Card>}
  </main>;
}
