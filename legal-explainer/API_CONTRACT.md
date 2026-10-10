# API CONTRACT

All request and response bodies are defined by the Zod schemas in `packages/shared/schemas.ts`. This file lists the endpoints. M1 builds the routes in `/apps/web/app/api/...`; each route wraps the module function from `packages/shared/contracts.ts`.

## Envelope

Every endpoint returns JSON in this shape (see `apiResponse` in `schemas.ts`):

```json
{ "ok": true, "data": { } }
{ "ok": false, "error": { "code": "BAD_INPUT | EXTRACTION_FAILED | LLM_FAILED | GROUNDING_FAILED | INTERNAL", "message": "..." } }
```

(`/api/report/pdf` returns the PDF file directly on success.)

## Endpoints

| Method and path | Owner | Request | Response `data` | Module function |
|---|---|---|---|---|
| `POST /api/ingest` | M1 | multipart form, field `file` (PDF) | `IngestResult` | `IngestFn` |
| `POST /api/analyze` | M2 | `AnalyzeRequest` | `AnalysisResult` | `AnalyzeFn` |
| `POST /api/ground` | M3 | `GroundRequest` | `Flag[]` (grounded) | `GroundFn` |
| `POST /api/compare` | M4 | `CompareRequest` | `CompareResult` | `CompareFn` |
| `POST /api/report` | M4 | `ReportRequest` | `Report` | `ReportFn` |
| `POST /api/report/pdf` | M4 | `Report` | PDF file | `RenderPdfFn` |
| `POST /api/review` | M1 | multipart: `file`, optional `language` | `Report` | runs ingest, analyze, ground, report in order |
| `POST /api/chat` | M4 (agent host by M1) | `ChatRequest` | `ChatResponse` | Cline agent with custom tools |
| `GET /api/sample` | M1 | none | `IngestResult` for the bundled sample agreement | none (reads a bundled file) |

## Data flow

```
PDF -> ingest -> IngestResult
                  |
                  v
             analyze (flags, risk, explanations)
                  |
                  v
             ground (citations, quote check)
                  |
                  v
             report (summary, questions, tips)  ->  Report  ->  UI / PDF

two versions -> ingest x2 -> compare -> CompareResult -> UI (and optionally into Report.comparison)

chat: Cline agent + tools (extract_clauses, analyze_clause, retrieve_law, verify_quote, compare_versions, build_report)
```

## Development without the real modules

During development each module folder exports a stub that returns the matching mock:

| Module | Mock file |
|---|---|
| ingest | `packages/shared/mocks/ingest.json` |
| analyze | `packages/shared/mocks/analysis.json` |
| ground | `packages/shared/mocks/grounded.json` |
| compare | `packages/shared/mocks/compare.json` |
| report | `packages/shared/mocks/report.json` |

Swap the stub for the real implementation when your module passes its schema on the sample documents.

## Rules

- Do not add fields to a schema without M1.
- Do not change a field's meaning. If you disagree with the contract, raise it before coding around it.
- Never return document text or secrets in error messages.
