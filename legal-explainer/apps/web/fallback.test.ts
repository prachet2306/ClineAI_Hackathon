// Deterministic fallback regression checks; no API keys or document contents are printed.
import assert from "node:assert/strict";
import { z } from "zod";
import { stage } from "./lib/modules";
async function main() {
  const schema = z.object({ value: z.string() });
  for (const [label, real] of [
    ["missing", async () => { throw new Error("Module unavailable"); }],
    ["throws", async () => { throw new Error("Provider failed"); }],
    ["invalid", async () => ({ wrong: true })],
    ["timeout", () => new Promise<never>(() => {})],
  ] as const) {
    const used: string[] = [];
    const result = await stage(label, real, schema, () => ({ value: "mock" }), used, 10);
    assert.equal(result.value, "mock"); assert.deepEqual(used, [label]); console.log(`PASS fallback ${label}`);
  }
  const used: string[] = [];
  const real = await stage("real", async () => ({ value: "real" }), schema, () => ({ value: "mock" }), used);
  assert.equal(real.value, "real"); assert.equal(used.length, 0); console.log("PASS real stage");
}
void main().catch(() => { console.error("FAIL fallback tests"); process.exitCode = 1; });
