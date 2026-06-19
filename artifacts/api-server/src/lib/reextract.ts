/**
 * Server-side driver for re-extracting a single held-back article.
 *
 * The crawler/extraction code lives in the `@workspace/scripts` leaf package,
 * which the API server must not import directly (leaf packages don't depend on
 * each other). Instead we spawn `scripts/src/reextract.ts` (dev, via `tsx`) or
 * its esbuild bundle `scripts/dist/reextract.mjs` (production) as a child
 * process and relay its output:
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
 * Spawn the re-extract child for `pageId` and relay its progress/result events.
 * Returns a cancel function (kills the child and clears the timeout) that the
 * caller should invoke if the client disconnects.
 */
export function runReextract(
  pageId: string,
  handlers: RunReextractHandlers,
): () => void {
  const isProd = process.env.NODE_ENV === "production";
  // Dev runs the TS source via the scripts package's local `tsx` bin (pnpm
  // installs it there, not at the repo root); prod runs the esbuild bundle with
  // plain `node` (no tsx/pnpm needed) — mirrors the redirect-health convention.
  const command = isProd
    ? "node"
    : path.join(REPO_ROOT, "scripts", "node_modules", ".bin", "tsx");
  const entry = isProd
    ? path.join(REPO_ROOT, "scripts", "dist", "reextract.mjs")
    : path.join(REPO_ROOT, "scripts", "src", "reextract.ts");

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
