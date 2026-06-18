/**
 * Load a Payload CMS export (the JSON produced by `export-payload.ts`) into a
 * live Payload instance via its Local API — the executable, one-command version
 * of the seed snippet documented in `./payload/README.md`. Instead of copying
 * `loadPayloadExport` into a Payload project, an operator points this CLI at
 * their Payload config and runs it directly.
 *
 * Run (inside a project that has `payload` installed and a config):
 *   PAYLOAD_CONFIG_PATH=./payload.config.ts \
 *     pnpm --filter @workspace/scripts run load:payload
 *   pnpm --filter @workspace/scripts run load:payload -- \
 *     --config ./payload.config.ts --in ./payload-export.json
 *
 * The reusable, tested load logic lives in `./payload/load.ts`
 * (`loadPayloadExport`); this wrapper only resolves the export JSON + the
 * Payload config and wires them together.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadCollections } from "./payload/import.js";
import { loadPayloadExport, type PayloadLike } from "./payload/load.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

export function parseFlag(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
  return undefined;
}

export function parseInPath(argv: string[]): string {
  const v = parseFlag(argv, "--in");
  if (v) return resolve(process.cwd(), v);
  // Default to the export's default output location (script-dir relative, so it
  // resolves correctly regardless of the process cwd).
  return resolve(SCRIPT_DIR, "../out/payload-export.json");
}

export function parseConfigPath(argv: string[]): string {
  const v = parseFlag(argv, "--config") ?? process.env.PAYLOAD_CONFIG_PATH;
  if (!v) {
    throw new Error(
      "No Payload config specified. Pass --config <path> or set " +
        "PAYLOAD_CONFIG_PATH to your Payload config file " +
        "(the module that default-exports buildConfig({...})).",
    );
  }
  return resolve(process.cwd(), v);
}

/**
 * Boot a Payload Local API instance from a config module path. Dynamically
 * imports both `payload` and the operator's config so this workspace never
 * hard-depends on a particular Payload install at module-load time — the CLI is
 * only usable where Payload and a config are actually present.
 */
export async function bootPayload(configPath: string): Promise<PayloadLike> {
  // Indirect specifier: the operator's Payload install is resolved at runtime,
  // so this workspace doesn't hard-depend on Payload's types being present to
  // typecheck the CLI.
  const payloadSpecifier = "payload";
  const { getPayload } = (await import(payloadSpecifier)) as {
    getPayload: (args: { config: unknown }) => Promise<PayloadLike>;
  };
  const configModule = (await import(pathToFileURL(configPath).href)) as {
    default: unknown;
  };
  const config = configModule.default;
  if (!config) {
    throw new Error(
      `Payload config at ${configPath} has no default export. It must ` +
        "default-export the result of buildConfig({...}).",
    );
  }
  return getPayload({ config });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const inPath = parseInPath(argv);
  const configPath = parseConfigPath(argv);

  console.log(`Reading Payload export from ${inPath}...`);
  const raw = JSON.parse(await readFile(inPath, "utf8")) as unknown;
  const collections = loadCollections(raw);

  console.log(
    `Loading into Payload (config: ${configPath}): ` +
      `${collections.media.length} media, ` +
      `${collections.authors.length} author(s), ` +
      `${collections.categories.length} categor(ies), ` +
      `${collections.tags.length} tag(s), ` +
      `${collections.posts.length} post(s)...`,
  );

  const payload = await bootPayload(configPath);
  const { idMap, counts } = await loadPayloadExport(payload, collections);

  console.log(
    `\nPayload load complete:\n` +
      `  media uploaded:      ${counts.media}\n` +
      `  authors created:     ${counts.authors}\n` +
      `  categories created:  ${counts.categories}\n` +
      `  tags created:        ${counts.tags}\n` +
      `  posts created:       ${counts.posts}\n` +
      `  UUID → id map size:  ${idMap.size}`,
  );
}

// Only run the CLI when this module is executed directly (not when imported by
// the combined `migrate-payload` wrapper, which reuses the helpers above).
const isEntrypoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Payload load failed:", err);
      process.exit(1);
    });
}
