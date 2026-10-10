// Stub IngestFn: returns the shared mock (packages/shared/mocks/ingest.json) so the UI and teammates are never blocked.
import type { IngestFn } from "../packages/shared/contracts";
import { IngestResultSchema } from "../packages/shared/schemas";
import mock from "../packages/shared/mocks/ingest.json";

export const ingestStub: IngestFn = async () => IngestResultSchema.parse(mock);
