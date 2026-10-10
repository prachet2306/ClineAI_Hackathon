// Node-only optional module loader. Uses the already-installed tsx runtime to avoid bundling SDK internals.
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

export const projectRoot = [process.cwd(), resolve(process.cwd(), "../..")]
  .find((dir) => existsSync(join(dir, "packages/shared/schemas.ts"))) ?? process.cwd();
let environmentLoaded = false;
export function loadEnvironment(): void {
  if (environmentLoaded) return;
  environmentLoaded = true;
  try { process.loadEnvFile(join(projectRoot, ".env")); } catch { /* environment variables may already be supplied */ }
}

const moduleCache = new Map<string, Promise<Record<string, unknown>>>();
export function loadModule(relative: string): Promise<Record<string, unknown>> {
  let pending = moduleCache.get(relative);
  if (!pending) {
    pending = importModule(relative);
    moduleCache.set(relative, pending);
    void pending.catch(() => moduleCache.delete(relative));
  }
  return pending;
}
async function importModule(relative: string): Promise<Record<string, unknown>> {
  loadEnvironment();
  const filename = join(projectRoot, relative);
  if (!existsSync(filename)) throw new Error("Module unavailable");
  const { tsImport } = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "tsx/esm/api");
  const loaded: unknown = await tsImport(pathToFileURL(filename).href, {
    parentURL: pathToFileURL(join(projectRoot, "agent/runtime.ts")).href,
    tsconfig: join(projectRoot, "tsconfig.json"),
  });
  if (!loaded || typeof loaded !== "object") throw new Error("Module unavailable");
  return loaded as Record<string, unknown>;
}

export async function deadline<T>(work: Promise<T>, ms: number, cancel?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error("This took too long, please try again."));
        try { cancel?.(); } catch { /* never leak provider errors */ }
      }, ms);
    })]);
  } finally { clearTimeout(timer); }
}
