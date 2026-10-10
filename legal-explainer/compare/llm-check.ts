// M4 live check for callLlmJson (separate from check.ts because it calls the real model).
// Run: npx.cmd tsx --env-file=.env compare/llm-check.ts   Prints PASS or FAIL only.
import { z } from "zod";
import { callLlmJson } from "./llm";

const GreetingSchema = z.object({ greeting: z.string().min(1) });

const main = async () => {
  try {
    const result = await callLlmJson(
      "You are a friendly assistant.",
      'Return a JSON object with one key "greeting" whose value is a short hello.',
      GreetingSchema,
    );
    GreetingSchema.parse(result);
    console.log("PASS");
  } catch {
    console.log("FAIL");
    process.exitCode = 1;
  }
};

void main();
