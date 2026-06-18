/**
 * Run the full DB → Payload migration in one command: export the migrated
 * content to JSON (the `export-payload.ts` step) and immediately load that JSON
 * into a live Payload instance (the `load-payload.ts` step), sharing a single
 * intermediate file path so an operator never has to manage it by hand.
 *
 * Run (inside a project that has `payload` installed and a config):
 *   PAYLOAD_CONFIG_PATH=./payload.config.ts \
 *     pnpm --filter @workspace/scripts run migrate:payload
 *   pnpm --filter @workspace/scripts run migrate:payload -- \
 *     --config ./payload.config.ts --out ./payload-export.json
 *
 * Honors the same conventions as the underlying CLIs:
 *   --config <path> / PAYLOAD_CONFIG_PATH   the Payload config to load into
 *   --out <path> / --in <path>              the intermediate export JSON path
 *                                           (default: scripts/out/payload-export.json)
 *
 * The reusable pieces are imported from `export-payload.ts` (`buildExport`) and
 * `load-payload.ts` (`bootPayload`, `parseConfigPath`); this wrapper only wires
 * the export step into the load step.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";
import { buildExport } from "./export-payload.js";
import { bootPayload, parseConfigPath, parseFlag } from "./load-payload.js";
import { loadPayloadExport } from "./payload/load.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the single intermediate export-JSON path. Accepts either `--out`
 * (export convention) or `--in` (load convention) — they name the same shared
 * file — and falls back to the package-anchored default both CLIs use.
 */
function parseExportPath(argv: string[]): string {
  const v = parseFlag(argv, "--out") ?? parseFlag(argv, "--in");
  if (v) return resolve(process.cwd(), v);
  return resolve(SCRIPT_DIR, "../out/payload-export.json");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const exportPath = parseExportPath(argv);
  // Resolve the config up front so a missing --config/PAYLOAD_CONFIG_PATH fails
  // before we spend time reading the database.
  const configPath = parseConfigPath(argv);

  // 1. Export: read the migration DB and write the export JSON.
  console.log("Reading migrated content from the database...");
  const result = await buildExport();
  await mkdir(dirname(exportPath), { recursive: true });
  await writeFile(exportPath, JSON.stringify(result, null, 2), "utf8");

  const c = result.collections;
  console.log(
    `Payload export written to ${exportPath}\n` +
      `  media:      ${c.media.length}\n` +
      `  authors:    ${c.authors.length}\n` +
      `  categories: ${c.categories.length}\n` +
      `  tags:       ${c.tags.length}\n` +
      `  posts:      ${c.posts.length}`,
  );

  // The export is on disk; release the migration DB pool before booting Payload.
  await pool.end();

  // 2. Load: boot the operator's Payload instance and load the export straight
  // in. Pass the in-memory collections directly — they're the same shape the
  // loader's `loadCollections` validates, and we just wrote them ourselves.
  console.log(
    `\nLoading into Payload (config: ${configPath}): ` +
      `${c.media.length} media, ` +
      `${c.authors.length} author(s), ` +
      `${c.categories.length} categor(ies), ` +
      `${c.tags.length} tag(s), ` +
      `${c.posts.length} post(s)...`,
  );

  const payload = await bootPayload(configPath);
  const { idMap, counts } = await loadPayloadExport(payload, result.collections);

  console.log(
    `\nMigration complete:\n` +
      `  media uploaded:      ${counts.media}\n` +
      `  authors created:     ${counts.authors}\n` +
      `  categories created:  ${counts.categories}\n` +
      `  tags created:        ${counts.tags}\n` +
      `  posts created:       ${counts.posts}\n` +
      `  UUID → id map size:  ${idMap.size}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("Payload migration failed:", err);
    // Best-effort pool cleanup in case we failed before the export's pool.end().
    await pool.end().catch(() => {});
    process.exit(1);
  });
