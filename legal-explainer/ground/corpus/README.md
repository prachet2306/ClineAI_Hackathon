# Reference corpus (M3)

`entries.json` is the list of reference sources that `/ground` can cite. Retrieval (`ground/retrieve.ts`) searches it, and the grounding step attaches matching entries to flags as citations.

**Never write legal content from memory.** Every entry must come from a real, public source that you opened and read. Wrong legal content is the biggest risk in this project.

## Entry format

`entries.json` is a JSON array. Each entry is an object with exactly these fields (extra fields are rejected):

| Field | Type | What to put in it |
|---|---|---|
| `sourceId` | string | Unique, stable id. Lowercase words joined with hyphens. Never reuse or rename an id once it is in use. |
| `title` | string | Name of the source as published (document or page title). |
| `snippet` | string | A short supporting extract (one to three sentences) **copied exactly** from the real source. Do not paraphrase or summarise. |
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

## How retrieval uses the fields

- Ranking is a keyword (BM25) search over `title`, `snippet` and `topics`. Matches in `title` and `topics` count a little more than matches in `snippet`.
- It matches words, not meaning, and queries are expected in English. Use the words a reader would search for, and keep the snippet focused on one point so entries rank sensibly.
- The entry with `sourceId` `placeholder` is ignored by retrieval, so it can never be cited. Delete it once real entries exist.
