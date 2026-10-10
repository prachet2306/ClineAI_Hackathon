// Re-exports the shared schemas and contracts so the web app imports them from one place.
import { DISCLAIMER, LANGUAGES, IngestResultSchema } from "@shared/schemas";
import type { IngestResult, Language } from "@shared/schemas";
import type { IngestFn } from "@shared/contracts";

export { DISCLAIMER, LANGUAGES, IngestResultSchema };
export type { IngestFn, IngestResult, Language };

