// Node-only chat bridge. Context is request-local; conversation history stays in the restricted agent host.
import { NextResponse } from "next/server";
import { ChatRequestSchema, ChatResponseSchema, ReportSchema, IngestResultSchema } from "@shared/schemas";
import { jsonRoute } from "@/lib/api-route";
import { loadModule, deadline } from "../../../../../agent/runtime";
export const runtime = "nodejs";
const Input = ChatRequestSchema.extend({ report: ReportSchema, ingest: IngestResultSchema });
export async function GET() {
  try {
    const host = await deadline(loadModule("agent/host.ts"), 15_000);
    return NextResponse.json({ available: (host.available as () => boolean)() });
  } catch { return NextResponse.json({ available: false }); }
}
export async function POST(request: Request) {
  return jsonRoute(request, Input, async (input) => {
    const host = await loadModule("agent/host.ts");
    return ChatResponseSchema.parse(await (host.chat as (raw: unknown) => Promise<unknown>)(input));
  });
}
