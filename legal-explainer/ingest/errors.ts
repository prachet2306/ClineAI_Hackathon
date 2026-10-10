// Typed errors for the ingest module. Messages are fixed strings and never contain document text.
export type IngestErrorCode = "BAD_INPUT" | "EXTRACTION_FAILED";

export class IngestError extends Error {
  readonly code: IngestErrorCode;

  constructor(code: IngestErrorCode, message: string) {
    super(message);
    this.name = "IngestError";
    this.code = code;
  }
}
