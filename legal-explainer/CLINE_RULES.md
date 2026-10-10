# CLINE RULES (every member's Cline session must follow these)

Read `PROJECT_BRIEF.md` for context and `API_CONTRACT.md` for endpoints. These rules keep four people's work compatible.

## Project in one line
An AI tool that turns a rental agreement (also employment and loan documents) into a simple risk report: extracted clauses, flagged concerns, plain-language explanations in English or Indian languages, questions to ask before signing, and a comparison of two contract versions. Findings are **issues to review, not legal conclusions**.

## Stack
TypeScript everywhere. Node 22+. Next.js (App Router) + Tailwind + shadcn/ui. Zod for schemas. `@cline/sdk` for the in-product agent. No database, no login.

## Ownership (edit only your own folder)
| Member | Folders |
|---|---|
| M1 | `/apps/web`, `/ingest`, `/agent`, `/packages/shared` |
| M2 | `/analyze` |
| M3 | `/ground` |
| M4 | `/compare`, `/report` |

- **Never edit `packages/shared/schemas.ts` or `contracts.ts`** unless you are M1. If you need a change, stop and ask M1 or say so in the group chat.
- Never edit another member's folder. If you need something from it, use its exported function or mock.
- Do not reformat or rename files you do not own.

## Contracts
- Implement exactly the function signature for your module in `packages/shared/contracts.ts`.
- Import types and schemas from `packages/shared/schemas.ts`. Never redefine them.
- **Parse at boundaries:** the output of your function must pass its Zod schema (`.parse()`); parse LLM output before returning it.
- Until your module works, export a stub that returns the matching file in `packages/shared/mocks/` so others are not blocked.
- Run `npm run validate:mocks` after any change to schemas or mocks.

## Code conventions
- TypeScript `strict`. No `any`. Prefer small pure functions.
- Async functions return data or throw an `Error`; the API layer converts errors into the `{ ok: false, error }` envelope.
- Read secrets only from environment variables (see `.env.example`). **Never hard-code or commit API keys.** Never log document contents or keys.
- Keep dependencies minimal. Ask before adding a new package.
- Add a short comment at the top of each file saying what it does.

## AI output rules (important)
1. **Never state a legal conclusion.** Use phrases like "worth asking about", "may matter", "could be unclear". Never "this is illegal" or "you should not sign".
2. **Quote-back:** every flag's `quote` must be an exact substring of the clause text.
3. **Citation-or-silence:** attach a citation only when retrieval supports it; otherwise set `grounding: "unverified"`. Never invent a statute, section number, figure or URL.
4. Output in the requested `language`. Keep explanations short, concrete and in simple words.
5. Every report includes the `DISCLAIMER` from `schemas.ts`.
6. Reference corpus entries must be verified against a real source and carry an `asOf` date.

## Cline SDK rules
- `@cline/sdk` runs **server-side only** (Node), never in browser code.
- Install the SDK skill: `npx skills add cline/sdk-skill`. Check https://docs.cline.bot/sdk before writing tool definitions; do not guess the API.
- The in-product agent gets **only our custom tools** (extract_clauses, analyze_clause, retrieve_law, verify_quote, compare_versions, build_report). No file, shell or web tools, because it handles private documents.
- Provider, model and API key come from `.env` (`CLINE_PROVIDER_ID`, `CLINE_MODEL_ID`, `CLINE_API_KEY`).
- Each module exports a plain function first; the tool wrapper lives next to it in the same folder and is registered by M1 in `/agent`.

## UI rules (M1 only)
- Use shadcn/ui components and the default theme. One accent colour; red/amber/green only for risk levels.
- Mobile-first, loading skeletons, empty states, friendly error messages.
- Always show the disclaimer on the report screen.
- UI reads data shaped by the shared schemas; build against `packages/shared/mocks/` first.

## Git workflow
- One branch per member: `m1/<topic>`, `m2/<topic>`, and so on. Small PRs into `main`; M1 merges.
- Commit often with clear messages (the history is evidence of Cline-assisted work for judges).
- Pull `main` before starting each work block. Do not force-push `main`.

## Evidence for the hackathon deliverables
- Screen-record your Cline sessions (short clips are fine) from the first commit.
- Add short notes to `docs/CLINE_LOG.md`: what you asked, what worked, what failed.
