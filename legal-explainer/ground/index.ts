// M3 grounding module (stub): exports `ground` and `retrieve` matching GroundFn and RetrieveFn.
// `ground` returns the mock grounded flags; `retrieve` returns no results until the real RAG is built.
import { z } from "zod";
import type { GroundFn, RetrieveFn } from "../packages/shared/contracts";
import { FlagSchema } from "../packages/shared/schemas";
import groundedMock from "../packages/shared/mocks/grounded.json" with { type: "json" };

const GroundedFlagsSchema = z.array(FlagSchema);

/** Stub: ignores its input and returns the mock flags, parsed at the boundary. */
export const ground: GroundFn = async () => {
  return GroundedFlagsSchema.parse(groundedMock);
};

/** Stub: no reference corpus yet, so there is nothing to retrieve. */
export const retrieve: RetrieveFn = async () => {
  return [];
};
