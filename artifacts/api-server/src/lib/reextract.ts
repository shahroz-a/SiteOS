/**
 * Server-side driver for re-extracting a single held-back article.
 *
 * The crawler/extraction code lives in the `@workspace/scripts` leaf package,
 * which the API server must not import directly (leaf packages don't depend on
 * each other). Instead we spawn its esbuild bundle `scripts/dist/reextract.mjs`
 * (production-safe — plain `node`, no tsx/pnpm) whenever it exists, falling back
 * to running `scripts/src/reextract.ts` via the scripts package's local `tsx`
 * bin in dev. The spawn command/entry are overridable via env for unusual
 * deploy layouts. We relay its output:
 *   - one NDJSON `{type:"progress",stage}` per pipeline stage on stderr
 *   - a single terminal `{type:"result",...}` or `{type:"error",...}` on stdout
 *
 * The caller forwards each event to the CMS review drawer so the editor sees
 * live progress (fetching → parsing → validating → storing) instead of a hang.
 * If the source is slow/unreachable the child is killed after a hard timeout
 * and a terminal timeout error is reported.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The source-fetch can stall; cap the whole run so the drawer never hangs. */
export const REEXTRACT_TIMEOUT_MS = 90_000;

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

const REPO_ROOT = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));

export interface ReextractEvent {
  type: "progress" | "result" | "error";
  [key: string]: unknown;
}

export interface RunReextractHandlers {
  onEvent: (event: ReextractEvent) => void;
  onClose: (info: { timedOut: boolean; code: number | null }) => void;
}

function parseEvent(line: string): ReextractEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (value && typeof value === "object" && "type" in value) {
      return value as ReextractEvent;
    }
  } catch {
    // Ignore non-JSON noise (e.g. stray library logging on stderr).
  }
  return null;
}

/** Read a stream line-by-line, invoking `onLine` for each complete line. */
function bufferLines(
  stream: NodeJS.ReadableStream | null,
  onLine: (line: string) => void,
): void {
  if (!stream) return;
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      onLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
  });
  stream.on("end", () => {
    if (buffer.trim()) onLine(buffer);
  });
}

/**
 * Decide how to launch the re-extract child.
 *
 * Preference order (production-safe first):
 *   1. Explicit env overrides (`REEXTRACT_ENTRY`, optional `REEXTRACT_COMMAND`)
 *      for unusual deploy layouts.
 *   2. The prebuilt esbuild bundle `scripts/dist/reextract.mjs` run with plain
 *      `node` — no `tsx`/pnpm or full repo layout needed at runtime. This is the
 *      default whenever the bundle exists (build it with `build:jobs`).
 *   3. Dev-only fallback: the TS source `scripts/src/reextract.ts` via the
 *      scripts package's local `tsx` bin (pnpm installs it there, not at the
 *      repo root).
 *
 * In production, the `tsx` fallback is intentionally NOT used — a missing bundle
 * (and no env override) is a deploy misconfiguration, so we throw a clear error
 * instead of silently depending on `tsx`/pnpm/the full repo layout at runtime.
 */
export function resolveReextractSpawn(): { command: string; entry: string } {
  const overrideCommand = process.env.REEXTRACT_COMMAND?.trim() || undefined;
  const overrideEntry = process.env.REEXTRACT_ENTRY?.trim() || undefined;
  if (overrideEntry) {
    return { command: overrideCommand ?? "node", entry: overrideEntry };
  }

  const bundle = path.join(REPO_ROOT, "scripts", "dist", "reextract.mjs");
  if (existsSync(bundle)) {
    return { command: overrideCommand ?? "node", entry: bundle };
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "re-extract worker is not available: the prebuilt bundle " +
        `${bundle} is missing. Build it with \`pnpm --filter @workspace/scripts run build:jobs\` ` +
        "or set REEXTRACT_ENTRY (and optional REEXTRACT_COMMAND) to point at the worker.",
    );
  }

  const tsx = path.join(REPO_ROOT, "scripts", "node_modules", ".bin", "tsx");
  const src = path.join(REPO_ROOT, "scripts", "src", "reextract.ts");
  return { command: overrideCommand ?? tsx, entry: src };
}

/**
 * Spawn the re-extract child for `pageId` and relay its progress/result events.
 * Returns a cancel function (kills the child and clears the timeout) that the
 * caller should invoke if the client disconnects.
 */
export function runReextract(
  pageId: string,
  handlers: RunReextractHandlers,
): () => void {
  let command: string;
  let entry: string;
  try {
    ({ command, entry } = resolveReextractSpawn());
  } catch (err) {
    // No runnable worker (e.g. missing prod bundle): report a terminal error
    // instead of throwing into the route so the drawer shows a clear failure.
    handlers.onEvent({
      type: "error",
      code: "failed",
      message: err instanceof Error ? err.message : String(err),
    });
    handlers.onClose({ timedOut: false, code: null });
    return () => {};
  }

  const child = spawn(command, [entry, pageId], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let timedOut = false;
  let closed = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, REEXTRACT_TIMEOUT_MS);

  bufferLines(child.stderr, (line) => {
    const event = parseEvent(line);
    if (event) handlers.onEvent(event);
  });
  bufferLines(child.stdout, (line) => {
    const event = parseEvent(line);
    if (event) handlers.onEvent(event);
  });

  const finish = (code: number | null) => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    handlers.onClose({ timedOut, code });
  };

  child.on("close", (code) => finish(code));
  child.on("error", (err) => {
    handlers.onEvent({
      type: "error",
      code: "failed",
      message: err instanceof Error ? err.message : String(err),
    });
    finish(null);
  });

  return () => {
    clearTimeout(timer);
    if (!child.killed) child.kill("SIGKILL");
  };
}
