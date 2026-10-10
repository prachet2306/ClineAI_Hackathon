// SDK spike A: proves a Cline Agent can call ONE custom tool (analyze_clause stub) and answer from its result.
// Run from the repo root:  node --env-file=.env --import tsx agent/spike.ts [--extras]
// Never prints the API key. Env vars come from Node's --env-file flag; this script never opens .env.
import { readFile } from "node:fs/promises";
import { Agent } from "@cline/sdk";
import { AnalysisResultSchema } from "../packages/shared/schemas";
import {
  MOCK_PATH,
  buildAnalyzeClauseTool,
  jsonInput,
  zod3Input,
  zod4Input,
  type AnalyzeClauseTool,
} from "./analyze-clause-tool";

const missing = ["CLINE_PROVIDER_ID", "CLINE_MODEL_ID", "CLINE_API_KEY"].filter((n) => !process.env[n]?.trim());
if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(", ")}. Check .env (see .env.example).`);
  process.exit(1);
}
const providerId = process.env.CLINE_PROVIDER_ID!.trim();
const modelId = process.env.CLINE_MODEL_ID!.trim();
const apiKey = process.env.CLINE_API_KEY!.trim();
const baseUrl = process.env.CLINE_BASE_URL?.trim() || undefined; // optional

/** Removes the API key from any text before it is printed. */
const redact = (text: string): string => text.split(apiKey).join("[redacted]");
const errText = (e: unknown): string => redact(e instanceof Error ? e.message : String(e));

/** Tries Zod 3, Zod 4 and plain JSON Schema; reports which ones createTool converts into a usable schema. */
function pickTool(): { label: string; tool: AnalyzeClauseTool } {
  const candidates: [string, unknown][] = [
    ["zod 3 schema (root zod)", zod3Input],
    ["zod 4 schema (zod/v4 subpath)", zod4Input],
    ["hand-written JSON Schema", jsonInput],
  ];
  let chosen: { label: string; tool: AnalyzeClauseTool } | undefined;
  for (const [label, schema] of candidates) {
    try {
      const tool = buildAnalyzeClauseTool(schema);
      const converted = tool.inputSchema as Record<string, unknown>;
      const props = converted.properties;
      const usable = converted.type === "object" && typeof props === "object" && props !== null && "documentId" in props;
      console.log(`[schema] ${label}: ${usable ? "usable" : "NOT usable"} -> ${JSON.stringify(converted)}`);
      if (usable && !chosen) chosen = { label, tool };
    } catch (error) {
      console.log(`[schema] ${label}: createTool threw: ${errText(error)}`);
    }
  }
  if (!chosen) throw new Error("No input schema form produced a usable tool definition.");
  return chosen;
}

type ToolResultSummary = { toolName: string; isError: boolean; output: unknown };

function toolResultsOf(result: { messages: readonly { content: readonly { type: string }[] }[] }): ToolResultSummary[] {
  const found: ToolResultSummary[] = [];
  for (const message of result.messages) {
    for (const part of message.content) {
      if (part.type !== "tool-result") continue;
      const p = part as unknown as { toolName: string; isError?: boolean; output: unknown };
      found.push({ toolName: p.toolName, isError: p.isError === true, output: p.output });
    }
  }
  return found;
}

function makeAgent(tool: AnalyzeClauseTool, systemPrompt: string) {
  const agent = new Agent({
    providerId,
    modelId,
    apiKey,
    baseUrl,
    systemPrompt,
    tools: [tool], // ONLY our custom tool. A direct Agent has no built-in file, shell or web tools.
    maxIterations: 6,
  });
  agent.subscribe((event) => {
    if (event.type === "tool-started") {
      console.log(`[event] tool-started: ${event.toolCall.toolName} input=${JSON.stringify(event.toolCall.input)}`);
    }
  });
  return agent;
}

const SYSTEM_PROMPT =
  "You review rental agreements. To analyze an agreement you MUST call the analyze_clause tool, " +
  "then answer in plain language using only the flags it returned. Say 'worth asking about', never give a legal verdict.";

async function main() {
  console.log(`[config] providerId=${providerId} modelId=${modelId} baseUrl=${baseUrl ? "set" : "not set"} apiKey=set`);
  const { label, tool } = pickTool();
  console.log(`[schema] using: ${label}`);

  const agent = makeAgent(tool, SYSTEM_PROMPT);
  const result = await agent.run("Analyze this agreement");
  const calls = toolResultsOf(result).filter((r) => r.toolName === "analyze_clause");
  const validData = calls.some((r) => !r.isError && AnalysisResultSchema.safeParse(r.output).success);

  const mock = AnalysisResultSchema.parse(JSON.parse(await readFile(MOCK_PATH, "utf8")));
  const answer = result.outputText.toLowerCase();
  const mentioned = mock.flags.filter(
    (f) => answer.includes(f.category.replace(/_/g, " ")) || answer.includes(f.clauseId.toLowerCase()),
  );

  console.log("\n===== RESULT =====");
  console.log(`status=${result.status} iterations=${result.iterations} runId=${result.runId}`);
  console.log(`usage=${JSON.stringify(result.usage)}`);
  if (result.error) console.log(`error=${errText(result.error)}`);
  console.log(`analyze_clause calls=${calls.length}; output passes AnalysisResultSchema=${validData}`);
  console.log(`answer mentions ${mentioned.length}/${mock.flags.length} mock flags (by category or clause id)`);
  console.log(`--- outputText (first 1500 chars) ---\n${redact(result.outputText.slice(0, 1500))}`);

  const passed = result.status === "completed" && calls.length > 0 && validData && mentioned.length > 0;
  console.log(`\nSPIKE A: ${passed ? "PASS" : "FAIL"}`);
  if (process.argv.includes("--extras")) await extras(agent, tool);
  process.exitCode = passed ? 0 : 1;
}

/** Extra checks: multi-turn history on one Agent, and a call to a tool that is not registered. */
async function extras(agent: ReturnType<typeof makeAgent>, tool: AnalyzeClauseTool) {
  console.log("\n===== EXTRA 1: does the same Agent keep history across run() calls? =====");
  const before = agent.snapshot().messages;
  const firstIdBefore = before[0]?.id;
  const second = await agent.run("In one sentence, how many risk flags did you just report?");
  const after = agent.snapshot().messages;
  const kept = after.length > before.length && after[0]?.id === firstIdBefore;
  console.log(`messages before 2nd run=${before.length}, after=${after.length}; status=${second.status}`);
  console.log(`2nd run() kept earlier history: ${kept}`);

  console.log("\n===== EXTRA 2: what if the model calls a tool that is not registered? =====");
  const probe = makeAgent(
    tool,
    'Before anything else you MUST call a tool named retrieve_law with {"query":"deposit"}. Then report exactly what that tool returned.',
  );
  const probeResult = await probe.run("Look up the law on deposits.");
  const probeCalls = toolResultsOf(probeResult).filter((r) => r.toolName === "retrieve_law");
  if (probeCalls.length === 0) console.log("model did not call retrieve_law, so the unknown-tool path was not observed");
  for (const c of probeCalls) console.log(`retrieve_law -> isError=${c.isError} output=${redact(JSON.stringify(c.output))}`);
  console.log(`probe run status=${probeResult.status}`);
}

main().catch((error: unknown) => {
  console.error(`Spike failed: ${errText(error)}`);
  process.exitCode = 1;
});

