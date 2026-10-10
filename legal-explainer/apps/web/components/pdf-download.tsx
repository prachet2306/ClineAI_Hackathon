// Fetches a real PDF in memory; download is shown only after successful rendering.
"use client";
import { useEffect, useState } from "react";
import type { Report } from "@shared/schemas";
import { Button } from "@/components/ui/button";
import { jsonBody } from "@/lib/client-api";
export function PdfDownload({ report }: { report: Report }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    let objectUrl = "";
    void (async () => {
      try {
        const response = await fetch("/api/report/pdf", { ...jsonBody(report), signal: controller.signal });
        if (!response.ok || !response.headers.get("content-type")?.includes("application/pdf")) return;
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
      } catch { /* optional feature */ } finally { clearTimeout(timer); }
    })();
    return () => { controller.abort(); clearTimeout(timer); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [report]);
  if (!url) return null;
  return <Button variant="outline" onClick={() => { const a = document.createElement("a"); a.href = url; a.download = "document-review.pdf"; a.click(); }}>Download PDF</Button>;
}
