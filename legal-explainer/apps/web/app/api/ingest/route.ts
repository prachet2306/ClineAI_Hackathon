// POST /api/ingest: accepts multipart (field "file": PDF or png/jpg/webp) or JSON {"text": "...", "filename"?: "..."}
// and returns { ok: true, data: IngestResult } or { ok: false, error }. Documents stay in memory; nothing is logged.
// Every request ends with a JSON answer: the whole call has an ~85 s deadline and any error becomes the error envelope.
import { NextResponse } from "next/server";
import { ingest, IngestError } from "../../../../../ingest/index";
import { TimeoutError, withTimeout } from "../../../../../ingest/llm";

const DEADLINE_MS = 85_000; // just under the browser's 90 s limit, so the client gets a real answer instead of timing out

export const runtime = "nodejs"; // pdf.js, tesseract.js and the Cline SDK need Node, not Edge
export const dynamic = "force-dynamic";

type ErrorCode = "BAD_INPUT" | "EXTRACTION_FAILED" | "INTERNAL";

const fail = (code: ErrorCode, message: string, status: number) =>
  NextResponse.json({ ok: false, error: { code, message } }, { status });

async function readInput(request: Request): Promise<{ bytes: Buffer; filename: string }> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new IngestError("BAD_INPUT", 'Send the document in the form field "file"');
    return { bytes: Buffer.from(await file.arrayBuffer()), filename: file.name || "upload" };
  }

  if (contentType.includes("application/json")) {
    const body: unknown = await request.json();
    const text = typeof body === "object" && body !== null ? (body as { text?: unknown }).text : undefined;
    const name = typeof body === "object" && body !== null ? (body as { filename?: unknown }).filename : undefined;
    if (typeof text !== "string" || !text.trim()) throw new IngestError("BAD_INPUT", 'Send pasted text as {"text": "..."}');
    return { bytes: Buffer.from(text, "utf8"), filename: typeof name === "string" && name ? name : "pasted-text.txt" };
  }

  throw new IngestError("BAD_INPUT", "Send multipart form data or a JSON body");
}

export async function POST(request: Request) {
  try {
    const data = await withTimeout(
      readInput(request).then(({ bytes, filename }) => ingest({ pdf: bytes, filename })),
      DEADLINE_MS,
    );
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof IngestError) return fail(error.code, error.message, error.code === "BAD_INPUT" ? 400 : 422);
    if (error instanceof SyntaxError) return fail("BAD_INPUT", "The request body is not valid JSON", 400);
    if (error instanceof TimeoutError) return fail("EXTRACTION_FAILED", "Reading the document took too long. Please try again.", 504);
    return fail("INTERNAL", "Something went wrong while reading the document", 500); // never echo error details
  }
}
