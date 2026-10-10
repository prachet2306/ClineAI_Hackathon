"use client";
// Preview card for a successful ingest: doc type, page count, OCR flag and a scrollable clause list.
// Analyze the extracted document using the session language.
import { Badge } from "@/components/ui/badge";
import { AnalyzeButton } from "@/components/analyze-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { IngestResult } from "@/lib/shared";

export function IngestPreview({ result }: { result: IngestResult }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="break-words">{result.filename}</CardTitle>
        <CardDescription>Preview of what was read from your document.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge className="capitalize">{result.docType}</Badge>
          <span className="text-muted-foreground">
            {result.pageCount} {result.pageCount === 1 ? "page" : "pages"}
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{result.usedOcr ? "OCR used" : "OCR not needed"}</span>
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">
            {result.clauses.length} {result.clauses.length === 1 ? "clause" : "clauses"} found
          </h2>
          <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto rounded-lg border p-2">
            {result.clauses.map((clause) => (
              <li key={clause.id} className="rounded-md bg-muted/50 p-3 text-sm">
                <span className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <span className="rounded bg-background px-1.5 py-0.5 font-mono">{clause.id}</span>
                  {clause.heading && <span className="truncate">{clause.heading}</span>}
                </span>
                <span className="break-words whitespace-pre-wrap">{clause.text}</span>
              </li>
            ))}
          </ul>
        </div>

        <AnalyzeButton />
      </CardContent>
    </Card>
  );
}
