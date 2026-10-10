// Optional real PDF export. The UI probes this with the current report and hides download on failure.
import { NextResponse } from "next/server";
import { ReportSchema } from "@shared/schemas";
import { renderPdf } from "@/lib/modules";
import { deadline } from "../../../../../../agent/runtime";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    return await deadline((async () => {
      const parsed = ReportSchema.safeParse(await request.json());
      if (!parsed.success) return NextResponse.json({ ok: false, error: { code: "BAD_INPUT", message: "A report is required." } }, { status: 400 });
      const bytes = await renderPdf(parsed.data);
      return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="document-review.pdf"', "Cache-Control": "no-store" } });
    })(), 20_000);
  } catch { return NextResponse.json({ ok: false, error: { code: "INTERNAL", message: "PDF download is unavailable." } }, { status: 503 }); }
}
