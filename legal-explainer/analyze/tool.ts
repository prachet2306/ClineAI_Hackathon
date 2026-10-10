/**
 * The `analyze_clause` tool (module 2) for the in-product Cline agent. A thin wrapper around the
 * plain analyze() function: it checks the model's input, builds a one-clause AnalyzeRequest,
 * calls analyze() and returns { flags }. It adds no prompt and no parsing of its own, so the
 * green flag rules and the exact-quote rule all come from analyze(). M1 registers this tool in
 * /agent (the agent gets only our custom tools). Never logs. Errors are short and never contain
 * clause text.
 *
 * Two things to know:
 *  - inputSchema is plain JSON Schema on purpose. The SDK bundles zod 4, this repo uses zod 3,
 *    and a zod 3 schema passed to createTool is silently sent to the model as a broken
 *    definition. The zod 3 schema below is used only to validate inside execute().
 *  - With ANALYZE_USE_STUB=1, analyze() returns the shared mock whatever clause it is given, so
 *    the tool then returns the mock's flags (clause ids c1 to c3), not flags for the input clause.
 */
import { createTool } from "@cline/sdk";
import { z } from "zod";
import type { AnalyzeFn } from "../packages/shared/contracts";
import {
  DocumentTypeSchema,
  LANGUAGES,
  LanguageSchema,
  type AnalyzeRequest,
  type Flag,
} from "../packages/shared/schemas";
import { AnalyzeError, analyze as realAnalyze } from "./analyze";
import { LLM_TIMEOUT_MS, LlmError } from "./llm";

export const ANALYZE_CLAUSE_TOOL_NAME = "analyze_clause";

/** The documentId used for the one-clause request, since the tool has no document of its own. */
export const TOOL_DOCUMENT_ID = "tool-call";

/**
 * How long the SDK lets one tool call run. analyze() may make two LLM calls (the first try plus
 * one retry), each allowed up to LLM_TIMEOUT_MS, so allow both plus 5 seconds. The SDK default
 * is 30 seconds, which is too short for a real analysis.
 */
export const ANALYZE_TOOL_TIMEOUT_MS = LLM_TIMEOUT_MS * 2 + 5_000;

const DESCRIPTION =
  "Check one contract clause for issues worth asking about. Returns flags with a category, a " +
  "risk level (red, amber or green), a plain-language explanation, why it may matter and " +
  "questions to ask. Pass the exact clause text. These are issues to review, not legal advice.";

/** Validates the model's input inside execute(). Plain zod 3; never passed to createTool. */
export const AnalyzeClauseInputSchema = z.object({
  clauseId: z.string().min(1),
  text: z.string().refine((value) => value.trim().length > 0),
  heading: z.string().optional(),
  docType: DocumentTypeSchema.default("other"),
  language: LanguageSchema.default("en"),
});
export type AnalyzeClauseInput = z.infer<typeof AnalyzeClauseInputSchema>;

/** What the model is told the input looks like. Must stay in step with AnalyzeClauseInputSchema. */
export const ANALYZE_CLAUSE_INPUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    clauseId: { type: "string", description: "Id of the clause, for example c3." },
    text: { type: "string", description: "The exact text of the clause, copied unchanged." },
    heading: { type: "string", description: "Optional clause heading, for example Security Deposit." },
    docType: {
      type: "string",
      enum: [...DocumentTypeSchema.options],
      description: "Kind of document. Defaults to other.",
    },
    language: {
      type: "string",
      enum: [...LANGUAGES],
      description: "Language for the explanations. Defaults to en.",
    },
  },
  required: ["clauseId", "text"],
  additionalProperties: false,
} as const;

export interface AnalyzeClauseOutput {
  flags: Flag[];
}

export interface AnalyzeClauseToolDeps {
  analyze: AnalyzeFn;
}

function parseInput(input: unknown): AnalyzeClauseInput {
  const parsed = AnalyzeClauseInputSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  // Field names only. Zod's messages can echo the offending value, which may be clause text.
  const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "(input)"))];
  throw new Error(`Invalid analyze_clause input: ${fields.join(", ")}`);
}

function buildRequest(input: AnalyzeClauseInput): AnalyzeRequest {
  const hasHeading = input.heading !== undefined && input.heading.trim() !== "";
  return {
    documentId: TOOL_DOCUMENT_ID,
    docType: input.docType,
    language: input.language,
    clauses: [
      {
        id: input.clauseId,
        index: 0,
        ...(hasHeading ? { heading: input.heading } : {}),
        text: input.text,
      },
    ],
  };
}

/** Builds the tool. Tests pass a fake analyze; production uses the real one. */
export function createAnalyzeClauseTool(deps: Partial<AnalyzeClauseToolDeps> = {}) {
  const run: AnalyzeFn = deps.analyze ?? realAnalyze;

  return createTool<unknown, AnalyzeClauseOutput>({
    name: ANALYZE_CLAUSE_TOOL_NAME,
    description: DESCRIPTION,
    inputSchema: ANALYZE_CLAUSE_INPUT_JSON_SCHEMA,
    // analyze() already retries once itself, so the SDK must not retry on top of that.
    retryable: false,
    timeoutMs: ANALYZE_TOOL_TIMEOUT_MS,
    execute: async (input) => {
      const request = buildRequest(parseInput(input));
      try {
        const result = await run(request);
        return { flags: result.flags };
      } catch (error) {
        // These two have fixed, safe messages. Anything else might carry clause text.
        if (error instanceof AnalyzeError || error instanceof LlmError) throw error;
        throw new Error("analyze_clause failed");
      }
    },
  });
}

/** The tool for M1 to register in /agent. Uses the real analyze(). */
export const analyzeClauseTool = createAnalyzeClauseTool();
