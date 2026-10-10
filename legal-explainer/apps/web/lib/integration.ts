// App-only integration envelopes; shared module schemas remain unchanged.
import { z } from "zod";
import { IngestResultSchema, LanguageSchema, ReportSchema, CompareResultSchema } from "@shared/schemas";
export const PipelineRequest = z.object({ ingest: IngestResultSchema, language: LanguageSchema.default("en") });
export const PipelineResult = z.object({ report: ReportSchema, usedMock: z.array(z.string()) });
export const ComparisonResult = z.object({ comparison: CompareResultSchema, usedMock: z.array(z.string()) });
