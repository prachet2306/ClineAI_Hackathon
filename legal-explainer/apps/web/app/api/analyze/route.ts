// Analyze -> ground -> report, with validated fallbacks and an explicit usedMock list.
import { jsonRoute } from "@/lib/api-route";
import { PipelineRequest } from "@/lib/integration";
import { pipeline } from "@/lib/modules";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return jsonRoute(request, PipelineRequest, ({ ingest, language }) => pipeline(ingest, language));
}
