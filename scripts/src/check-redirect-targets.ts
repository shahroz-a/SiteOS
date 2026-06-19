/**
 * CLI: verify that the targets of the preserved redirect map are still
 * reachable, and deliver a digest of any broken ones over a chat webhook
 * and/or email.
 *
 * The pure orchestration lives in `prerender/redirect-target-health.ts`; this
 * file wires it to the live DB (active redirects + published content), an HTTP
 * probe for off-blog targets, and the two delivery channels.
 *
 * Delivery channels (used together or independently, both optional):
 *   - Chat webhook: set `REDIRECT_HEALTH_WEBHOOK_URL` (Slack / Discord / Teams
 *     incoming webhook). The digest body is POSTed as `{ "text": ... }`.
 *   - Email: set `REDIRECT_HEALTH_EMAIL_TO` (comma/space-separated recipients)
 *     plus SMTP config (`REDIRECT_HEALTH_SMTP_HOST`, `..._PORT`, `..._USER`,
 *     `..._PASS`, `..._SECURE`) and a sender (`REDIRECT_HEALTH_EMAIL_FROM`,
 *     defaults to the SMTP user). Works with any SMTP provider — Gmail (app
 *     password), Outlook, SendGrid SMTP (`smtp.sendgrid.net`, user `apikey`),
 *     Mailgun, etc.
 *
 * Quiet-on-clean: when no targets are broken, nothing is delivered unless
 * `--notify-on-clean` (or `REDIRECT_HEALTH_NOTIFY_ON_CLEAN=1`) is set. The full
 * digest is ALWAYS printed to stdout regardless.
 *
 * Exit code: 0 even when targets are broken (so a scheduled run isn't marked
 * failed just for finding problems — the digest is the signal). Non-zero only
 * when the run itself can't complete (e.g. the DB is unreachable).
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run verify:redirect-targets
 *   pnpm --filter @workspace/scripts run verify:redirect-targets -- --limit=50
 *   pnpm --filter @workspace/scripts run verify:redirect-targets -- --notify-on-clean
 */
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  redirectsTable,
  pagesTable,
  categoriesTable,
  authorsTable,
} from "@workspace/db";
import {
  buildOnBlogPathSet,
  checkRedirectTargets,
  formatHealthDigest,
  onBlogExistsIn,
  shouldNotify,
  type HealthDigest,
  type RedirectInput,
} from "./prerender/redirect-target-health";

// --- Args -----------------------------------------------------------------

function numArg(name: string): number | undefined {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return undefined;
  const n = Number(raw.split("=")[1]);
  return Number.isFinite(n) ? n : undefined;
}

const LIMIT = numArg("limit");
const CONCURRENCY = numArg("concurrency") ?? 8;
const NOTIFY_ON_CLEAN =
  process.argv.includes("--notify-on-clean") ||
  process.env.REDIRECT_HEALTH_NOTIFY_ON_CLEAN === "1";

// --- Off-blog HTTP probe --------------------------------------------------

/** Probe an absolute URL. Treats any 2xx/3xx as healthy. Tries a HEAD first
 * (cheap) and falls back to GET when a server rejects HEAD (405/501). */
async function probe(
  url: string,
): Promise<{ ok: boolean; status: number | null }> {
  const attempt = async (
    method: "HEAD" | "GET",
  ): Promise<{ ok: boolean; status: number | null }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, {
        method,
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": "headout-blog-redirect-health/1.0" },
      });
      return { ok: res.status < 400, status: res.status };
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    const head = await attempt("HEAD");
    if (head.status === 405 || head.status === 501) return attempt("GET");
    return head;
  } catch {
    try {
      return await attempt("GET");
    } catch {
      return { ok: false, status: null };
    }
  }
}

// --- Email delivery -------------------------------------------------------

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
  to: string[];
}

export type EmailConfigResult =
  | { kind: "disabled" }
  | { kind: "error"; message: string }
  | { kind: "ok"; config: EmailConfig };

/** Split a recipients string on commas / semicolons / whitespace. */
export function parseRecipients(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Resolve the email config from env, or report why email is disabled / broken.
 * Email is opt-in via `REDIRECT_HEALTH_EMAIL_TO`: if it's empty, email is
 * simply disabled (`disabled`). If recipients are set but the SMTP host or a
 * usable sender is missing, that's an operator misconfiguration (`error`) the
 * CLI surfaces loudly without failing the run.
 */
export function resolveEmailConfig(
  env: Record<string, string | undefined>,
): EmailConfigResult {
  const to = parseRecipients(env.REDIRECT_HEALTH_EMAIL_TO);
  if (to.length === 0) return { kind: "disabled" };

  const host = env.REDIRECT_HEALTH_SMTP_HOST?.trim();
  if (!host) {
    return {
      kind: "error",
      message:
        "REDIRECT_HEALTH_EMAIL_TO is set but REDIRECT_HEALTH_SMTP_HOST is missing.",
    };
  }
  const user = env.REDIRECT_HEALTH_SMTP_USER?.trim() || undefined;
  const pass = env.REDIRECT_HEALTH_SMTP_PASS ?? undefined;
  const from = env.REDIRECT_HEALTH_EMAIL_FROM?.trim() || user;
  if (!from) {
    return {
      kind: "error",
      message:
        "No sender address: set REDIRECT_HEALTH_EMAIL_FROM (or REDIRECT_HEALTH_SMTP_USER).",
    };
  }

  const port = Number(env.REDIRECT_HEALTH_SMTP_PORT ?? "587");
  const secure =
    env.REDIRECT_HEALTH_SMTP_SECURE !== undefined
      ? /^(1|true|yes)$/i.test(env.REDIRECT_HEALTH_SMTP_SECURE)
      : port === 465; // implicit TLS on 465, STARTTLS otherwise

  return {
    kind: "ok",
    config: {
      host,
      port: Number.isFinite(port) ? port : 587,
      secure,
      user,
      pass,
      from,
      to,
    },
  };
}

// Minimal structural type for the bit of nodemailer we use (avoids depending on
// @types/nodemailer, which isn't available in this environment).
interface MailTransport {
  sendMail(opts: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<unknown>;
}
interface NodemailerModule {
  createTransport(opts: {
    host: string;
    port: number;
    secure: boolean;
    auth?: { user: string; pass: string };
  }): MailTransport;
}

async function sendEmail(
  config: EmailConfig,
  digest: HealthDigest,
): Promise<void> {
  const nodemailer = (await import("nodemailer")) as unknown as NodemailerModule;
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth:
      config.user !== undefined && config.pass !== undefined
        ? { user: config.user, pass: config.pass }
        : undefined,
  });
  await transport.sendMail({
    from: config.from,
    to: config.to.join(", "),
    subject: digest.subject,
    text: digest.text,
  });
}

// --- Webhook delivery -----------------------------------------------------

async function postWebhook(url: string, text: string): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw new Error(`webhook responded ${res.status} ${res.statusText}`);
  }
}

// --- Main -----------------------------------------------------------------

async function main(): Promise<void> {
  // Active redirects to evaluate.
  let redirects: RedirectInput[] = (
    await db
      .select({
        fromPath: redirectsTable.fromPath,
        toPath: redirectsTable.toPath,
      })
      .from(redirectsTable)
      .where(eq(redirectsTable.isActive, true))
  ).map((r) => ({ fromPath: r.fromPath, toPath: r.toPath }));

  if (LIMIT !== undefined) redirects = redirects.slice(0, LIMIT);

  // Published content used to verify on-blog targets without a meaningless HTTP
  // probe (the static SPA returns 200 for every path).
  const [posts, categories, authors] = await Promise.all([
    db
      .select({ slug: pagesTable.slug })
      .from(pagesTable)
      .where(eq(pagesTable.status, "published")),
    db.select({ slug: categoriesTable.slug }).from(categoriesTable),
    db.select({ slug: authorsTable.slug }).from(authorsTable),
  ]);
  const onBlogSet = buildOnBlogPathSet({
    postSlugs: posts.map((p) => p.slug),
    categorySlugs: categories.map((c) => c.slug),
    authorSlugs: authors.map((a) => a.slug),
  });

  const report = await checkRedirectTargets(redirects, {
    onBlogExists: (target) => onBlogExistsIn(onBlogSet, target),
    probe,
    concurrency: CONCURRENCY,
  });

  const digest = formatHealthDigest(report);

  // Always print the full digest to stdout.
  console.log(`\n=== redirect-target health ===`);
  console.log(digest.text);
  console.log("");

  const notify = shouldNotify(report, NOTIFY_ON_CLEAN);

  // --- Webhook ---
  const webhookUrl = process.env.REDIRECT_HEALTH_WEBHOOK_URL?.trim();
  if (webhookUrl && notify) {
    try {
      await postWebhook(webhookUrl, digest.text);
      console.log("[notify] webhook: delivered.");
    } catch (err) {
      console.error("[notify] webhook: FAILED -", err);
    }
  } else if (webhookUrl) {
    console.log("[notify] webhook: skipped (clean run; --notify-on-clean off).");
  }

  // --- Email ---
  const email = resolveEmailConfig(process.env);
  if (email.kind === "error") {
    console.error(`[notify] email: misconfigured - ${email.message}`);
  } else if (email.kind === "ok" && notify) {
    try {
      await sendEmail(email.config, digest);
      console.log(
        `[notify] email: delivered to ${email.config.to.join(", ")}.`,
      );
    } catch (err) {
      console.error("[notify] email: FAILED -", err);
    }
  } else if (email.kind === "ok") {
    console.log("[notify] email: skipped (clean run; --notify-on-clean off).");
  }

  if (!webhookUrl && email.kind === "disabled") {
    console.log(
      "[notify] no delivery channel configured " +
        "(set REDIRECT_HEALTH_WEBHOOK_URL and/or REDIRECT_HEALTH_EMAIL_TO).",
    );
  }
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (isEntrypoint) {
  main()
    .then(async () => {
      await pool.end().catch(() => {});
    })
    .catch(async (err) => {
      console.error("[check-redirect-targets]", err);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}
