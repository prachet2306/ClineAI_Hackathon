// Safe Node API boundary with a deadline and fixed errors, never raw validation/provider details.
import { NextResponse } from "next/server";
import { z } from "zod";
import { deadline } from "../../../agent/runtime";
export async function jsonRoute<T>(request: Request, schema: z.ZodType<T, z.ZodTypeDef, unknown>, work: (input: T) => Promise<unknown>) {
  try {
    return await deadline((async () => {
      let body: unknown;
      try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: {
        code: "BAD_INPUT", message: "Please send a valid JSON request." } }, { status: 400 }); }
      const parsed = schema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ ok: false, error: { code: "BAD_INPUT",
        message: "Please check the document and required fields, then try again." } }, { status: 400 });
      return NextResponse.json({ ok: true, data: await work(parsed.data) });
    })(), 80_000);
  } catch { return NextResponse.json({ ok: false, error: { code: "INTERNAL",
    message: "We couldn't finish this request. Please try again." } }, { status: 503 }); }
}
