// Public entry of the ingest module. `ingest` is the IngestFn; set INGEST_USE_MOCK=true to get the shared mock instead.
import type { IngestFn } from "../packages/shared/contracts";
import { ingest as realIngest } from "./ingest";
import { ingestStub } from "./stub";

export { realIngest, ingestStub };
export { IngestError } from "./errors";

export const ingest: IngestFn = (input) =>
  process.env.INGEST_USE_MOCK?.trim().toLowerCase() === "true" ? ingestStub(input) : realIngest(input);
