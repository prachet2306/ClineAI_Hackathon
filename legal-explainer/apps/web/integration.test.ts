// Integration smoke test: HTTP contracts, sample report/compare/PDF/chat; prints metadata only.
// Run with a dev server: node --import tsx apps/web/integration.test.ts
import assert from "node:assert/strict";
import { IngestResultSchema, ReportSchema, CompareResultSchema, ChatResponseSchema } from "../../packages/shared/schemas";
const base = process.env.TEST_BASE_URL ?? "http://localhost:3102";
async function post(path: string, body: unknown) {
  const response = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
  const envelope = await response.json();
  assert(response.ok && envelope.ok, `Request failed: ${path} (${response.status})`);
  return envelope.data;
}
async function main() {
for (const path of ["/", "/report", "/compare"]) {
  assert.equal((await fetch(base + path)).status, 200); console.log(`PASS page ${path}`);
}
const textA = await (await fetch(base + "/sample-agreement.txt")).text();
const textB = await (await fetch(base + "/sample-agreement-v2.txt")).text();
const lf = (s: string) => s.replace(/\r\n/g, "\n").trim();
assert.equal(lf(textA).replace("fifteen (15)", "seven (7)"), lf(textB));
const versionA = IngestResultSchema.parse(await post("/api/ingest", { text: textA }));
const versionB = IngestResultSchema.parse(await post("/api/ingest", { text: textB }));
console.log(`PASS ingest: ${versionA.clauses.length}/${versionB.clauses.length} clauses`);
const result = await post("/api/analyze", { ingest: versionA, language: "en" });
const report = ReportSchema.parse(result.report);
assert(report.flags.length > 0); assert.equal(report.documentId, versionA.documentId);
assert(report.flags.every((f) => !f.quoteVerified || versionA.clauses.some((c) => c.id === f.clauseId && c.text.includes(f.quote))));
assert(report.flags.every((f) => f.grounding !== "unverified" || f.citations.length === 0));
console.log(`PASS pipeline: flags=${report.flags.length} usedMock=${JSON.stringify(result.usedMock)}`);
const compared = await post("/api/compare", { versionA, versionB, language: "en" });
const comparison = CompareResultSchema.parse(compared.comparison);
assert(comparison.changes.length > 0);
assert(comparison.changes.some((c) => c.beforeText?.includes("15") && c.afterText?.includes("7")));
console.log(`PASS comparison: changes=${comparison.changes.length} usedMock=${JSON.stringify(compared.usedMock)}`);
const pdf = await fetch(base + "/api/report/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report) });
assert.equal(pdf.status, 200); const bytes = Buffer.from(await pdf.arrayBuffer()); assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
console.log(`PASS PDF: bytes=${bytes.length}`);
for (const path of ["/api/analyze", "/api/compare", "/api/chat"]) {
  const r = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(r.status, 400); console.log(`PASS invalid input ${path}`);
}
const availability = await (await fetch(base + "/api/chat")).json();
if (availability.available) {
  const input = { documentId: versionA.documentId, ingest: versionA, report, language: "en" };
  const first = ChatResponseSchema.parse(await post("/api/chat", { ...input, message: "Use verify_quote to check the first flag's quote. Briefly explain the result." }));
  const second = ChatResponseSchema.parse(await post("/api/chat", { ...input, sessionId: first.sessionId, message: "Which quote did I just ask you to check? Answer briefly." }));
  assert.equal(first.sessionId, second.sessionId); assert(first.answer.length > 0 && second.answer.length > 0);
  console.log("PASS chat: two turns, same conversation");
} else console.log("SKIP chat: provider unavailable");
console.log("DONE");
}
void main().catch(() => { console.error("FAIL integration check (no document details logged)"); process.exitCode = 1; });
