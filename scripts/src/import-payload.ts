/**
 * Import (round-trip) Payload CMS collection documents back into the migration
 * database — the reverse of `export-payload.ts`. Reads the same JSON shape that
 * the export produces (and that a Payload instance can re-emit after editors
 * change content) and upserts it into the migration DB so Payload edits flow
 * back into the site.
 *
 * Run:
 *   pnpm --filter @workspace/scripts run import:payload
 *   pnpm --filter @workspace/scripts run import:payload -- --in ./payload-export.json
 *
 * The DB-touching logic lives in `./payload/import.ts` (CLI-free, unit-tested).
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";
import { importExport, loadCollections } from "./payload/import.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

function parseInPath(argv: string[]): string {
  const idx = argv.indexOf("--in");
  if (idx !== -1 && argv[idx + 1]) return resolve(process.cwd(), argv[idx + 1]!);
  // Default to the export's default output location (script-dir relative, so it
  // resolves correctly regardless of the process cwd).
  return resolve(SCRIPT_DIR, "../out/payload-export.json");
}

async function main(): Promise<void> {
  const inPath = parseInPath(process.argv.slice(2));
  console.log(`Reading Payload export from ${inPath}...`);
  const raw = JSON.parse(await readFile(inPath, "utf8")) as unknown;
  const collections = loadCollections(raw);

  console.log(
    `Importing: ${collections.posts.length} post(s), ` +
      `${collections.authors.length} author(s), ` +
      `${collections.categories.length} categor(ies), ` +
      `${collections.tags.length} tag(s), ` +
      `${collections.media.length} media...`,
  );
  const stats = await importExport(collections);

  console.log(
    `\nPayload round-trip import complete:\n` +
      `  authors upserted:    ${stats.authors}\n` +
      `  categories upserted: ${stats.categories}\n` +
      `  tags upserted:       ${stats.tags}\n` +
      `  hero media linked:   ${stats.media}\n` +
      `  posts created:       ${stats.postsCreated}\n` +
      `  posts updated:       ${stats.postsUpdated}\n` +
      `  posts unchanged:     ${stats.postsUnchanged}`,
  );
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Payload import failed:", err);
    await pool.end();
    process.exit(1);
  });
