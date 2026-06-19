#!/usr/bin/env node
/**
 * Deterministic stand-in for the real re-extract worker
 * (`scripts/src/reextract.ts` / its esbuild bundle), used by
 * `reextract.integration.test.ts`.
 *
 * The API server's NDJSON bridge (`lib/reextract.ts`) spawns the worker and
 * supports swapping the binary via the `REEXTRACT_ENTRY` / `REEXTRACT_COMMAND`
 * env overrides. This fixture mirrors the real worker's WIRE CONTRACT exactly —
 * one `{type:"progress",stage}` NDJSON line per stage on **stderr** and a single
 * terminal `{type:"result"|"error",...}` line on **stdout** — but produces a
 * fixed outcome chosen by `REEXTRACT_FIXTURE_MODE`, so the route + bridge +
 * client stream contract can be exercised without a real DB or network fetch.
 *
 * It deliberately stresses two regression-prone parts of the bridge:
 *   - all five progress events are written in ONE stderr chunk, so a bridge that
 *     stops splitting on newlines would collapse them.
 *   - stray non-JSON noise is written to stderr, which the bridge must ignore.
 */
const mode = process.env.REEXTRACT_FIXTURE_MODE || "pass";
const pageId = process.argv[2] || "unknown";

const line = (obj) => `${JSON.stringify(obj)}\n`;

const STAGES = ["loading", "fetching", "parsing", "validating", "storing"];

// Emit every progress event in a SINGLE stderr write to exercise the server
// bridge's newline buffering, plus stray noise it must ignore.
process.stderr.write(
  STAGES.map((stage) => line({ type: "progress", stage })).join(""),
);
process.stderr.write("this is not json\n\n");

// Flush the terminal stdout line BEFORE exiting (writing then exiting can
// truncate a piped write), then exit with the same codes the real CLI uses:
// 0 for a result (pass OR validation fail), 1 for a thrown error.
function finish(payload, code) {
  process.stdout.write(line(payload), () => process.exit(code));
}

if (mode === "pass") {
  finish(
    {
      type: "result",
      pageId,
      slug: "things-to-do-in-rome",
      url: "https://www.headout.com/blog/things-to-do-in-rome/",
      changed: true,
      validationStatus: "pass",
      validationScore: 96,
      pageStatus: "published",
      heldBack: false,
    },
    0,
  );
} else if (mode === "fail") {
  finish(
    {
      type: "result",
      pageId,
      slug: "things-to-do-in-rome",
      url: "https://www.headout.com/blog/things-to-do-in-rome/",
      changed: true,
      validationStatus: "fail",
      validationScore: 40,
      pageStatus: "draft",
      heldBack: true,
    },
    0,
  );
} else if (mode === "unreachable") {
  finish(
    {
      type: "error",
      code: "unreachable",
      message: "The source responded with HTTP 503.",
    },
    1,
  );
} else {
  finish(
    { type: "error", code: "failed", message: `unknown fixture mode: ${mode}` },
    1,
  );
}
