// OCR for scanned PDFs and images. Prefers a vision model through the same Cline gateway settings as /agent
// (CLINE_PROVIDER_ID, CLINE_MODEL_ID, CLINE_API_KEY, optional CLINE_BASE_URL); falls back to tesseract.js.
// INGEST_OCR=vision | tesseract | auto (default auto: vision first, tesseract if the gateway fails or times out).
// Every OCR step has a time limit so a request can never hang: vision ~30 s per call (agent is aborted),
// tesseract ~45 s in total (its worker is always terminated). Nothing from the document or the API key is logged.
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Worker } from "tesseract.js";
import { IngestError } from "./errors";
import { assertGatewayAvailable, gatewayConfig, guardedRun, withTimeout } from "./llm";

export type OcrImage = { data: Uint8Array; mediaType: "image/png" | "image/jpeg" | "image/webp" };

const VISION_TIMEOUT_MS = 30_000;
const TESSERACT_TIMEOUT_MS = 45_000;

const PROMPT =
  "Transcribe all text in this image exactly as written, in reading order. Keep numbering, headings, " +
  "line breaks and punctuation. Do not summarise, translate, correct or add anything. " +
  "Output only the transcribed text. If there is no readable text, output nothing.";

async function visionOcr(image: OcrImage): Promise<string> {
  assertGatewayAvailable(); // skip straight to tesseract if the gateway just timed out
  const config = gatewayConfig();
  // The ignore comments keep Next's bundler away from the SDK; Node loads it at runtime (it cannot be bundled).
  const { Agent } = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "@cline/sdk");
  const agent = new Agent({
    ...config,
    systemPrompt: "You are an OCR engine. You only transcribe text from images.",
    tools: [], // no tools: the model only reads the image
    maxIterations: 1,
  });
  const run = agent.run([
    {
      id: randomUUID(),
      role: "user",
      createdAt: Date.now(),
      content: [
        { type: "text", text: PROMPT },
        { type: "image", image: image.data, mediaType: image.mediaType },
      ],
    },
  ]);
  const result = await guardedRun(agent, run, VISION_TIMEOUT_MS);
  if (result.status !== "completed" || !result.outputText.trim()) throw new Error("Vision OCR returned no text");
  return result.outputText;
}

/** tesseract.js reads png and jpeg directly; webp is re-encoded to png first. */
async function tesseractReadable(image: OcrImage): Promise<Buffer> {
  if (image.mediaType !== "image/webp") return Buffer.from(image.data);
  const { createCanvas, loadImage } = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "@napi-rs/canvas");
  const img = await loadImage(Buffer.from(image.data));
  const canvas = createCanvas(img.width, img.height);
  canvas.getContext("2d").drawImage(img, 0, 0);
  return canvas.toBuffer("image/png");
}

async function tesseractOcr(images: OcrImage[]): Promise<string[]> {
  // tesseract.js spawns a worker from its own files, so it must not be bundled either.
  const { createWorker } = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "tesseract.js");
  const state: { worker?: Worker; cancelled: boolean } = { cancelled: false };
  const stop = async (): Promise<void> => {
    state.cancelled = true;
    await state.worker?.terminate().catch(() => undefined);
  };

  const work = async (): Promise<string[]> => {
    // Cache only the English language model (not document data) in the OS temp folder.
    const worker = await createWorker("eng", 1, { cachePath: join(tmpdir(), "ingest-tessdata") });
    state.worker = worker;
    if (state.cancelled) {
      await worker.terminate().catch(() => undefined); // timed out while the worker was starting
      throw new Error("OCR was cancelled");
    }
    const pages: string[] = [];
    for (const image of images) {
      const { data } = await worker.recognize(await tesseractReadable(image));
      pages.push(data.text);
    }
    return pages;
  };

  try {
    return await withTimeout(work(), TESSERACT_TIMEOUT_MS, () => void stop());
  } finally {
    await stop(); // the worker is always terminated, on success, failure or timeout
  }
}

export async function ocrImages(images: OcrImage[]): Promise<string[]> {
  const mode = (process.env.INGEST_OCR ?? "auto").trim().toLowerCase();
  try {
    if (mode !== "tesseract") {
      try {
        const pages: string[] = [];
        for (const image of images) pages.push(await visionOcr(image));
        console.info("[ingest] OCR engine: vision");
        return pages;
      } catch {
        if (mode === "vision") throw new IngestError("EXTRACTION_FAILED", "Vision OCR failed");
      }
    }
    const pages = await tesseractOcr(images);
    console.info("[ingest] OCR engine: tesseract");
    return pages;
  } catch (error) {
    if (error instanceof IngestError) throw error;
    throw new IngestError("EXTRACTION_FAILED", "Could not read text from the scanned document");
  }
}
