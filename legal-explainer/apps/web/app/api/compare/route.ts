// Compare two ingested documents; optional module failure becomes a labelled demo fallback.
import { CompareRequestSchema } from "@shared/schemas";
import { jsonRoute } from "@/lib/api-route";
import { compareDocuments } from "@/lib/modules";
export const runtime = "nodejs";
export async function POST(request: Request) { return jsonRoute(request, CompareRequestSchema, compareDocuments); }
