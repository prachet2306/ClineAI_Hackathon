# Reference corpus (M3)

`entries.json` is the list of reference sources that `/ground` can cite. Retrieval (`ground/retrieve.ts`) searches it, and the grounding step attaches matching entries to flags as citations.

**Never write legal content from memory.** Every entry must come from a real, public source that you opened and read. Wrong legal content is the biggest risk in this project.

## Entry format

`entries.json` is a JSON array. Each entry is an object with exactly these fields (extra fields are rejected):

| Field | Type | What to put in it |
|---|---|---|
| `sourceId` | string | Unique, stable id. Lowercase words joined with hyphens. Never reuse or rename an id once it is in use. |
| `title` | string | Name of the source as published (document or page title). |
| `snippet` | string | A short supporting extract (one to four sentences) **copied exactly** from the real source. Do not paraphrase or summarise. |
| `url` | string | The real, working URL of the page or document the snippet came from. |
| `asOf` | string | Date of the source version you read: `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. |
| `docTypes` | array | One or more of `"rental"`, `"employment"`, `"loan"`, `"other"`. |
| `topics` | array | One or more clause categories this entry helps with (list below). |

Allowed `topics` values (the `ClauseCategory` values in `packages/shared/schemas.ts`, which is the source of truth):

`deposit`, `rent`, `rent_escalation`, `lock_in`, `termination`, `notice_period`, `maintenance`, `penalties`, `fees`, `entry_access`, `renewal`, `dispute_resolution`, `non_compete`, `other`

## Template

Copy this, replace every `<...>`, and add it to the array in `entries.json`. It is a template and is not valid JSON until you fill it in.

```json
{
  "sourceId": "<unique-lowercase-hyphenated-id>",
  "title": "<title of the source as published>",
  "snippet": "<short extract copied exactly from the source>",
  "url": "<real URL you opened>",
  "asOf": "<YYYY, YYYY-MM or YYYY-MM-DD>",
  "docTypes": ["<rental | employment | loan | other>"],
  "topics": ["<one or more ClauseCategory values>"]
}
```

## How to add an entry

1. Find the real source (official government or regulator page, or the published text of the law or guideline).
2. Open it and copy a short, self-contained extract into `snippet`, exactly as written.
3. Copy the URL from the page you actually read, and note the date of that version in `asOf`.
4. Pick `docTypes` and `topics` from the allowed values above.
5. Add the object to `entries.json` and check that the file is valid (command below).
6. If you are not sure a fact is right, leave the entry out. No entry is better than a wrong entry.

## Check the file

From the repo root:

```
npx tsx -e "import('./ground/types.ts').then(m => console.log(m.loadCorpus().length + ' entries OK'))"
```

A bad entry fails with a message that names the entry number, its `sourceId` and the problem. The tests in `ground/types.test.ts` also load the shipped `entries.json`.

## Check snippets against the source PDF

Save each source PDF in `ground/corpus/source/` and register its entry `url` in `SOURCES` in `check-snippets.ts` (PDF path, required title prefix, and whether section numbers are allowed in titles). Then, from the repo root:

```
npx tsx ground/corpus/check-snippets.ts
```

The script re-extracts the PDF text (with `unpdf`, installed in `ground/package.json`) and fails, with exit code 1, if any snippet is not an exact substring of it after whitespace is collapsed. It also checks each title against the source's rules. The placeholder entry is skipped. Run `cd ground && npm install` once to get `unpdf`. To read a PDF's extracted text yourself: `npx tsx ground/corpus/extract-text.ts <pdf> <output.txt>`.

Entries from `PRS-Legislative-Brief-MTA-2021.pdf` are a PRS summary, not the statute. Their titles start with `PRS summary of the Model Tenancy Act 2021:` and carry no section numbers, because we only quote what is printed in that document. PRS allows non-commercial reuse with acknowledgement of PRS Legislative Research.

## How retrieval uses the fields

- Ranking is a keyword (BM25) search over `title`, `snippet` and `topics`. Matches in `title` and `topics` count a little more than matches in `snippet`.
- It matches words, not meaning, and queries are expected in English. Use the words a reader would search for, and keep the snippet focused on one point so entries rank sensibly.
- An entry with `sourceId` `placeholder` (a stand-in used before real entries existed) is ignored by retrieval and can never be cited. The shipped corpus no longer contains one.
- When grounding a flag, a retrieved entry may be cited only if its `topics` include the flag's category, or its BM25 score is at or above `RELEVANCE_SCORE_THRESHOLD` (`ground/relevance.ts`). So set `topics` carefully: list only the categories the snippet itself supports. Re-measure the threshold when entries are added or changed.
