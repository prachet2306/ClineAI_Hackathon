// Browser request helpers with validation, no persistence, and caller-owned cancellation.
import { z } from "zod";
import { apiResponse, IngestResultSchema, type IngestResult, type Language } from "@shared/schemas";
import { PipelineResult } from "@/lib/integration";
import { setSession } from "@/lib/session";
export async function requestData<T>(url: string, init: RequestInit, schema: z.ZodType<T, z.ZodTypeDef, unknown>, signal: AbortSignal): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { ...init, signal }); }
  catch { throw new Error(signal.aborted ? "This took too long, please try again." : "Couldn't reach the server. Please try again."); }
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error("Couldn't read the response. Please try again."); }
  const parsed = apiResponse(z.unknown()).safeParse(body);
  if (!parsed.success) throw new Error("The server returned an unexpected response. Please try again.");
  if (!parsed.data.ok) throw new Error(parsed.data.error.message);
  if (!response.ok) throw new Error("The request failed. Please try again.");
  const data = schema.safeParse(parsed.data.data);
  if (!data.success) throw new Error("The server returned an unexpected response. Please try again.");
  return data.data;
}
export const jsonBody = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export function ingestDocument(input: File | string, signal: AbortSignal) {
  if (typeof input === "string") return requestData("/api/ingest", jsonBody({ text: input }), IngestResultSchema, signal);
  if (!/\.(pdf|png|jpe?g|webp)$/i.test(input.name) || input.size === 0 || input.size > 10 * 1024 * 1024)
    throw new Error("Choose a non-empty PDF, PNG, JPG or WEBP under 10 MB.");
  const body = new FormData(); body.append("file", input);
  return requestData("/api/ingest", { method: "POST", body }, IngestResultSchema, signal);
}
export async function analyzeDocument(ingest: IngestResult, language: Language, signal: AbortSignal) {
  const value = await requestData("/api/analyze", jsonBody({ ingest, language }), PipelineResult, signal);
  setSession({ result: ingest, report: value.report, usedMock: value.usedMock });
  return value;
}
