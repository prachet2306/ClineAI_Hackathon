"use client";
// Preview card for a successful ingest: doc type, page count, OCR flag and a scrollable clause list.
// Task 6 will enable the Analyze button; for now it is disabled.
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
              <li key={clause.id} className="rounded-md bg-muted/50 p-2 text-sm">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">{clause.id}</span>
                <span className="break-words whitespace-pre-wrap">{clause.text}</span>
              </li>
            ))}
          </ul>
        </div>

        <Button className="w-full" size="lg" disabled>
          Analyze – Coming next
        </Button>
      </CardContent>
    </Card>
  );
}
