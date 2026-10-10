// analyze_clause tool for the Cline agent. Stub: returns packages/shared/mocks/analysis.json, validated by AnalysisResultSchema.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createTool } from "@cline/sdk";
import { z } from "zod";
import { z as z4 } from "zod/v4";
import { AnalysisResultSchema, type AnalysisResult } from "../packages/shared/schemas";

export const MOCK_PATH = fileURLToPath(new URL("../packages/shared/mocks/analysis.json", import.meta.url));

const TOOL_DESCRIPTION =
  "Analyze the rental agreement's clauses. Returns risk flags (category, risk level, quote, " +
  "plain-language explanation, questions to ask) as JSON. Call it once, then summarize the flags. " +
  "Stub: always returns the sample analysis; documentId is optional and ignored.";
const DOCUMENT_ID_HELP = "Id of the document to analyze. Optional; the stub ignores it.";

// The same input shape in three forms, so the spike can observe which one createTool turns into a usable JSON Schema.
export const zod3Input = z.object({ documentId: z.string().optional().describe(DOCUMENT_ID_HELP) });
export const zod4Input = z4.object({ documentId: z4.string().optional().describe(DOCUMENT_ID_HELP) });
export const jsonInput: Record<string, unknown> = {
  type: "object",
  properties: { documentId: { type: "string", description: DOCUMENT_ID_HELP } },
};

export type AnalyzeClauseInput = z.infer<typeof zod3Input>;
export type AnalyzeClauseOutput = AnalysisResult | { error: string };

/** Returns the mock analysis, parsed with the shared schema (parse at boundaries). */
export async function analyzeClause(input: AnalyzeClauseInput): Promise<AnalyzeClauseOutput> {
  if (!zod3Input.safeParse(input ?? {}).success) return { error: "Invalid input for analyze_clause." };
  try {
    const raw: unknown = JSON.parse(await readFile(MOCK_PATH, "utf8"));
    return AnalysisResultSchema.parse(raw);
  } catch {
    return { error: "analyze_clause stub failed to load or validate the mock analysis." };
  }
}

/** Builds the tool from any of the three schema forms. The cast is deliberate: the SDK bundles its own Zod 4. */
export function buildAnalyzeClauseTool(inputSchema: unknown) {
  return createTool<AnalyzeClauseInput, AnalyzeClauseOutput>({
    name: "analyze_clause",
    description: TOOL_DESCRIPTION,
    inputSchema: inputSchema as Record<string, unknown>,
    execute: async (input) => analyzeClause(input),
  });
}

export type AnalyzeClauseTool = ReturnType<typeof buildAnalyzeClauseTool>;
