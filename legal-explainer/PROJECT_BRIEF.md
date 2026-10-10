# PROJECT BRIEF: Legal Document Explainer (read this first)

> Upload this file to your Cline session at the start. It summarises everything decided so far, so you can work on your part without the original chat. Also read `CLINE_RULES.md` and `API_CONTRACT.md`.

## 1. The hackathon

**Cline AI Builder Hackathon, Round 2.** Pick one real problem Indian society faces and, in **8 hours**, build a working AI-powered product that a real person could use tomorrow, using **Cline as the coding partner from the first commit to the last**. Bonus points for using **Cline inside the product itself** (for example via the Cline SDK).

**Deliverables**
1. Public GitHub repo with a README covering the problem, solution, architecture, tech stack, setup steps and how Cline was used.
2. PPT: problem, solution, architecture, AI models/tools, how Cline was used (in the build *and* inside the product), challenges, future scope.
3. **Demo video (mandatory):** a short walkthrough with a real user scenario, showing Cline in action during the build.
4. Social media post tagging Cline (brownie points).

**Judged on:** creativity and uniqueness, innovation, real-world usefulness, effective use of Cline, product usability and overall execution, technical implementation.

## 2. Our idea

**Problem: information asymmetry in everyday contracts.** The party who drafts a contract understands it; the party who signs usually doesn't, and can't afford a lawyer. First-time renters, freshers and first-time borrowers lose deposits, get locked into bad terms, or pay hidden charges, usually discovered after the damage is done. English legalese is an extra barrier for many Indians, and many agreements are scanned or photographed.

**Solution:** upload a PDF (rental agreement is the hero use case; employment contracts and loan documents are extensions). The system:
1. Extracts the clauses.
2. Flags potentially concerning ones (vague deposit deductions, one-sided notice periods, automatic rent hikes, hidden fees).
3. Explains each in simple English or an Indian language.
4. Grounds every flag in reference sources and the document's own text, to avoid hallucination.
5. Generates **questions to ask before signing** and negotiation tips, plus a downloadable summary.
6. **Clause Comparison Engine (unique feature):** compares two versions of a contract and explains what changed and why it might matter.

**Non-negotiable framing:** findings are **issues to review, never definitive legal conclusions**. Use wording like "worth asking about". Every report carries the disclaimer in `schemas.ts`.

## 3. Five modules and owners

| # | Module | Owner | Folder | Function contract (`packages/shared/contracts.ts`) |
|---|---|---|---|---|
| 1 | Ingest and extract (PDF to text, OCR fallback, clause split) + **app shell** + integration lead | **M1** | `/ingest`, `/apps/web` | `IngestFn` |
| 2 | Clause analysis and risk flags (category, plain-language explanation, green/amber/red, why it matters, language support) | **M2** | `/analyze` | `AnalyzeFn` |
| 3 | Grounded checking (RAG): reference corpus, citations, quote-back verification, citation-or-silence | **M3** | `/ground` | `GroundFn`, `RetrieveFn` |
| 4 | Clause Comparison Engine (semantic diff) | **M4** | `/compare` | `CompareFn` |
| 5 | Action pack (questions to ask, negotiation tips, PDF export) | **M4** | `/report` | `ReportFn`, `RenderPdfFn` |

M4 also owns the "explain this change" agent features and the chat UI component.

## 4. Tech stack (TypeScript end to end)

The Cline SDK is TypeScript on Node.js 22+, so the whole project is TypeScript.

| Layer | Choice |
|---|---|
| App | **Next.js** (App Router) with API routes, Tailwind CSS, **shadcn/ui** |
| Agent runtime | **`@cline/sdk`** (server side only) |
| Schemas | **Zod**, in `packages/shared/schemas.ts` |
| PDF text | `pdfjs-dist` or `unpdf`; OCR with `tesseract.js` or an LLM with vision |
| RAG | Small curated corpus, precomputed embeddings in a JSON file, cosine search. No vector database |
| LLM | Via the SDK's provider gateway; provider and model come from `.env` |

Skip: database, login, state-management libraries, animation libraries, charts, custom CSS, i18n libraries (ask the model to answer in the chosen language).

Frontend fallback if Next.js causes trouble: Vite + React with the same Tailwind and shadcn setup, plus a small Express server for the agent.

## 5. Cline SDK: what we know

- `@cline/sdk` is an open-source TypeScript agent runtime, same harness as the Cline VS Code extension and CLI. It re-exports `@cline/core` (sessions, built-in tools, persistence), and also exposes `@cline/agents` (stateless loop), `@cline/llms` (provider gateway) and `@cline/shared`.
- Basic usage from the docs: create an `Agent` with `providerId`, `modelId` and `apiKey`, then call `agent.run("...")`. It supports custom tools, persistent sessions, MCP and subagents.
- Docs: https://docs.cline.bot/sdk (overview, examples, tools, plugins). A quickstart example is in the `cline/cline` GitHub repo under `apps/examples/quickstart`.
- **Install the SDK skill so your Cline knows the real API:** `npx skills add cline/sdk-skill`.
- **Caution:** the docs show more than one API style (an older `cline` package with `ClineAgent`, and the newer `@cline/sdk` with `Agent`). We use `@cline/sdk`. Confirm exact tool-definition syntax in the docs before coding; this brief does not guarantee it.

## 6. How Cline is used inside the product

**Each module is exposed as a custom tool, and a Cline agent can orchestrate them.**

| Tool | Owner | Purpose |
|---|---|---|
| `extract_clauses` | M1 | PDF to structured clauses |
| `analyze_clause` | M2 | Category, explanation, risk level |
| `retrieve_law` and `verify_quote` | M3 | Cite sources, confirm quotes exist |
| `compare_versions` | M4 | Semantic diff of two versions |
| `build_report` | M4 | Questions, tips, PDF |

Two modes:
1. **Deterministic pipeline** for the main report (ingest, analyze, ground, report). Fast and predictable for the demo.
2. **Agent mode** for the "ask the document" chat, "explain this change", and a "deep review" button where the agent chooses tools. Sessions persist so a user can return to a document.

**Safety:** in the product the agent gets **only our custom tools**, no file, shell or web tools, because it handles private documents. Check the docs for how to restrict built-in tools.

## 7. Integration rules (how four people stay compatible)

1. **One source of truth:** `packages/shared/schemas.ts` (Zod). Only **M1** edits it, after telling the team. Everyone imports from it.
2. **Plain functions first:** each module is a plain function matching `packages/shared/contracts.ts`, usable without the UI or the agent. Wrap as a Cline tool afterwards.
3. **Mocks from minute one:** `packages/shared/mocks/*.json` already exist. Until your module works, your folder exports a stub returning the mock.
4. **Per-module folders:** nobody edits another person's folder. Shared things (schemas, app shell, agent host) go through M1.
5. **Branches and PRs:** one branch per member (`m1/...`, `m2/...`), small PRs into `main`, M1 merges.
6. **Sync points:** around hour 4 (one sample agreement end to end with real modules) and hour 6.5 (feature freeze, bug fixes only).
7. **Shared test documents:** one clean rental agreement PDF, one scanned PDF, and a "version 2" with a planted change. Use the same files so bugs are reproducible.

Repo layout:

```
/apps/web            Next.js app (M1)
/packages/shared     schemas.ts, contracts.ts, mocks/, validate-mocks.ts
/ingest  /analyze  /ground  /compare  /report  /agent
/docs                CLINE_LOG.md and demo notes
CLINE_RULES.md  API_CONTRACT.md  PROJECT_BRIEF.md  README.md
```

## 8. Frontend plan (M1 only)

Three screens plus a drawer:
- **Upload:** drag-and-drop, language selector, **"Try with a sample agreement"** button (saves the demo if live upload fails).
- **Report:** overall risk at the top, clause cards with green/amber/red badges, explanation, citations, questions to ask, disclaimer banner.
- **Compare:** two versions side by side with a change list and severity badges.
- **Chat drawer:** "ask the document", powered by the Cline agent.

Design rules: shadcn default theme, one accent colour, red/amber/green only for risk, one font, generous spacing, loading skeletons, empty and error states, **mobile-first** (the PS stresses basic smartphones). Others never edit the UI; they deliver JSON matching the schema, and M1 builds screens from the mocks.

## 9. Per-member responsibilities

**M1 (ingest, shell, integration lead)**
- Hour 0: repo, install deps, `npm run validate:mocks`, Next.js shell, `Agent` hello-world with the SDK skill.
- Build `ingest` (PDF text, OCR fallback, clause splitting, doc type guess) and the upload UI.
- Own the agent host (creates the `Agent`, registers tools, manages sessions, reads `.env`).
- Wire endpoints, run the pipeline, build Report UI and risk highlights.
- Last 1.5 hours: README and repo cleanup.

**M2 (analysis)**
- Strict JSON output validated by `AnalysisResultSchema`. Every `quote` must be an **exact substring** of the clause text.
- Prompts for rental first, then employment and loan. Output in the selected language (en, hi, as, bn, ta, te, mr).
- Phrasing: "worth asking about", never a verdict. Include `questionsToAsk` and a `suggestion` where useful.
- Tune on the sample documents. Last 1.5 hours: PPT.

**M3 (grounding and RAG)**
- Build a small curated corpus (hour 0 onward, independent of others): tenancy law basics, contract-law provisions, RBI fair-practice and key-fact-statement guidance for loans, labour basics, plus a clause pattern library (fair vs red-flag examples). Every entry has `sourceId`, `title`, `snippet`, `url`, `asOf`. **Verify each fact against the real source** before it goes in; wrong legal content is the biggest risk.
- `GroundFn`: for each flag, verify the quote is an exact substring of the clause (`quoteVerified`), retrieve supporting sources, attach `citations`, set `grounding` to `supported` or `unverified` (citation-or-silence: if nothing supports it, say so).
- `RetrieveFn` for the chat agent.
- Last 1.5 hours: record and edit the demo video.

**M4 (comparison and action pack)**
- `CompareFn`: align clauses by meaning, classify each change as added, removed, softened, hardened or reworded, set `favors` and `severity`, flag silent changes. Compare UI component.
- `ReportFn`: overall risk, merged de-duplicated questions (most important first), negotiation tips. `RenderPdfFn` for download.
- Agent features: "explain this change" and the chat component, plus wrapping compare and report as tools.
- Last 1.5 hours: end-to-end testing and the social post.

## 9b. Timeline

| Hours | M1 | M2 | M3 | M4 |
|---|---|---|---|---|
| 0-1 | Repo, SDK hello-world, Next.js shell | Prompts against mocks | Corpus collection, embeddings | Diff design, report layout |
| 1-3 | Ingest + OCR, upload UI | Analysis | Retrieval + quote check | Comparison |
| 3-4.5 | Register tools, pipeline end to end | Language support | Citation-or-silence | Report and PDF |
| 4.5-6 | Agent chat session, risk UI | Prompt tuning | Corpus expansion | Compare UI, explain-change agent |
| 6-8 | README, integration | PPT | Demo video | E2E testing, social post |

Cut line if time runs short: drop the money-impact calculator and extra languages first; keep analysis, flags, comparison and export.

## 10. Demo story

Take one realistic rental agreement with three planted traps (vague deposit deductions, one-sided notice period, 15% automatic rent increase). Upload it and show the flags with plain-language explanations in a chosen language. Upload "version 2" where the landlord quietly shortened the landlord notice from 15 to 7 days, and let the comparison engine catch it. End with the ask-before-signing list. Show Cline both building the app (recorded sessions) and working inside it (agent chat).

## 11. Cline-in-the-build evidence (needed for the video, README and PPT)

- **Screen-record Cline sessions from the first commit**, even 30-second clips.
- Each member keeps notes in `docs/CLINE_LOG.md`: what you asked Cline, what worked, what failed.
- Commit often with clear messages so the history shows Cline-assisted work.

## 12. Current status

- Done: shared Zod schemas, module function contracts, mock data, validation script, project docs.
- **Not yet run:** `npm install && npm run validate:mocks && npm run typecheck`. The workspace where these files were generated had no access to the npm registry, so the Zod check has not been executed. The mock JSON was checked separately (parses, and all quotes are exact substrings). **M1: run these first and fix any issue before others build on it.**
- Open items: confirm exact Cline SDK tool-definition API; choose provider and model in `.env`; collect sample PDFs; start the M3 corpus.
