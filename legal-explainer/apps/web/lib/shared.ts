// Re-exports the shared schemas and contracts so the web app imports them from one place.
import { DISCLAIMER } from "@shared/schemas";
import type { IngestFn } from "@shared/contracts";

export { DISCLAIMER };
export type { IngestFn };
