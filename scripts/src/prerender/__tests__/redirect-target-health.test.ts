import { describe, expect, it, vi } from "vitest";
import {
  DEAD_HTTP_STATUSES,
  OFF_BLOG_DEAD_THRESHOLD,
  buildOnBlogPathSet,
  checkRedirectTargets,
  decideHealth,
  formatHealthDigest,
  normalizeTargetPath,
  onBlogExistsIn,
  readingVerdict,
  shouldNotify,
  targetKind,
  targetScope,
  totalBroken,
  type CheckDeps,
  type RedirectInput,
} from "../redirect-target-health";
import {
  parseRecipients,
  resolveEmailConfig,
} from "../../check-redirect-targets";

describe("targetKind", () => {
  it("treats /blog/... targets as on-blog and everything else as off-blog", () => {
    expect(targetKind("/blog/new-name/")).toBe("on-blog");
    expect(targetKind("/london-theatre-tickets/six-e-9858/")).toBe("off-blog");
    expect(targetKind("/blog/category/things-to-do")).toBe("on-blog");
  });
});

describe("normalizeTargetPath", () => {
  it("is trailing-slash insensitive", () => {
    expect(normalizeTargetPath("/blog/x/")).toBe("/blog/x");
    expect(normalizeTargetPath("/blog/x")).toBe("/blog/x");
  });

  it("strips query strings and fragments", () => {
    expect(normalizeTargetPath("/blog/x/?utm=1")).toBe("/blog/x");
    expect(normalizeTargetPath("/blog/x/#section")).toBe("/blog/x");
  });

  it("collapses the bare root to /", () => {
    expect(normalizeTargetPath("/blog/")).toBe("/blog");
    expect(normalizeTargetPath("/")).toBe("/");
    expect(normalizeTargetPath("")).toBe("/");
  });
});

describe("readingVerdict", () => {
  it("on-blog: exists => alive, missing => dead", () => {
    expect(readingVerdict({ kind: "on-blog", exists: true })).toBe("alive");
    expect(readingVerdict({ kind: "on-blog", exists: false })).toBe("dead");
  });

  it("off-blog: only 404/410 are dead", () => {
    for (const s of DEAD_HTTP_STATUSES) {
      expect(readingVerdict({ kind: "off-blog", status: s })).toBe("dead");
    }
    expect(readingVerdict({ kind: "off-blog", status: 200 })).toBe("alive");
    expect(readingVerdict({ kind: "off-blog", status: 301 })).toBe("alive");
  });

  it("off-blog: transient/server statuses are alive, not dead", () => {
    expect(readingVerdict({ kind: "off-blog", status: 403 })).toBe("alive");
    expect(readingVerdict({ kind: "off-blog", status: 429 })).toBe("alive");
    expect(readingVerdict({ kind: "off-blog", status: 500 })).toBe("alive");
    expect(readingVerdict({ kind: "off-blog", status: 503 })).toBe("alive");
  });

  it("off-blog: a failed probe (null status) is unknown, never dead", () => {
    expect(readingVerdict({ kind: "off-blog", status: null })).toBe("unknown");
  });
});

describe("decideHealth", () => {
  it("on-blog dead deactivates immediately (deterministic)", () => {
    expect(decideHealth("on-blog", "dead", 0)).toEqual({
      failures: 1,
      deactivate: true,
      reason: "on-blog-target-missing",
    });
  });

  it("on-blog alive keeps the redirect and resets the counter", () => {
    expect(decideHealth("on-blog", "alive", 3)).toEqual({
      failures: 0,
      deactivate: false,
      reason: null,
    });
  });

  it("off-blog requires repeated dead readings before acting", () => {
    // First confirmed-dead reading: counted, but not yet retired.
    const first = decideHealth("off-blog", "dead", 0);
    expect(first).toEqual({ failures: 1, deactivate: false, reason: null });
    // Second confirmed-dead reading reaches the threshold and deactivates.
    const second = decideHealth("off-blog", "dead", 1);
    expect(second).toEqual({
      failures: 2,
      deactivate: true,
      reason: "off-blog-target-dead",
    });
  });

  it("off-blog: a healthy reading resets a pending counter (flaky-reading guard)", () => {
    expect(decideHealth("off-blog", "alive", 1)).toEqual({
      failures: 0,
      deactivate: false,
      reason: null,
    });
  });

  it("off-blog: an unknown reading preserves the counter and takes no action", () => {
    expect(decideHealth("off-blog", "unknown", 1)).toEqual({
      failures: 1,
      deactivate: false,
      reason: null,
    });
  });

  it("honours a custom threshold", () => {
    // prevFailures 1 -> 2, still below a threshold of 3: no action yet.
    expect(decideHealth("off-blog", "dead", 1, 3)).toEqual({
      failures: 2,
      deactivate: false,
      reason: null,
    });
    // prevFailures 2 -> 3 reaches the custom threshold and deactivates.
    expect(decideHealth("off-blog", "dead", 2, 3)).toEqual({
      failures: 3,
      deactivate: true,
      reason: "off-blog-target-dead",
    });
    // Default threshold is the documented constant.
    expect(OFF_BLOG_DEAD_THRESHOLD).toBe(2);
  });
});

const okProbe = vi.fn(async () => ({ ok: true, status: 200 }));

function deps(over: Partial<CheckDeps> = {}): CheckDeps {
  return {
    onBlogExists: () => true,
    probe: okProbe,
    ...over,
  };
}

describe("targetScope", () => {
  it("classifies on-blog vs off-blog targets", () => {
    expect(targetScope("/blog/paris-guide/")).toBe("on-blog");
    expect(targetScope("https://www.headout.com/london/")).toBe("off-blog");
  });
});

describe("buildOnBlogPathSet / onBlogExistsIn", () => {
  const set = buildOnBlogPathSet({
    postSlugs: ["paris-guide"],
    categorySlugs: ["europe"],
    authorSlugs: ["jane-doe"],
  });

  it("includes index, search, posts, categories and authors (slash-insensitive)", () => {
    expect(onBlogExistsIn(set, "/blog/paris-guide/")).toBe(true);
    expect(onBlogExistsIn(set, "/blog/paris-guide")).toBe(true);
    expect(onBlogExistsIn(set, "/blog/category/europe")).toBe(true);
    expect(onBlogExistsIn(set, "/blog/author/jane-doe/")).toBe(true);
    expect(onBlogExistsIn(set, "/blog")).toBe(true);
    expect(onBlogExistsIn(set, "/blog/search?q=x")).toBe(true);
  });

  it("ignores query/hash when matching and rejects unknown paths", () => {
    expect(onBlogExistsIn(set, "/blog/paris-guide/?utm=1#top")).toBe(true);
    expect(onBlogExistsIn(set, "/blog/retired-article/")).toBe(false);
  });
});

describe("checkRedirectTargets", () => {
  it("verifies on-blog targets against published content (no HTTP probe)", async () => {
    const probe = vi.fn(async () => ({ ok: true, status: 200 }));
    const redirects: RedirectInput[] = [
      { fromPath: "/blog/old-a/", toPath: "/blog/live/" },
      { fromPath: "/blog/old-b/", toPath: "/blog/gone/" },
    ];
    const report = await checkRedirectTargets(
      redirects,
      deps({
        probe,
        onBlogExists: (t) => t === "/blog/live/",
      }),
    );
    expect(probe).not.toHaveBeenCalled();
    expect(report.checkedRedirects).toBe(2);
    expect(report.broken).toHaveLength(1);
    expect(report.broken[0].target).toBe("/blog/gone/");
    expect(report.broken[0].scope).toBe("on-blog");
  });

  it("HTTP-probes off-blog targets and flags 4xx/5xx + network errors", async () => {
    const probe = vi.fn(async (url: string) => {
      if (url.includes("dead")) return { ok: false, status: 404 };
      if (url.includes("boom")) throw new Error("ECONNREFUSED");
      return { ok: true, status: 200 };
    });
    const redirects: RedirectInput[] = [
      { fromPath: "/blog/a/", toPath: "/london/" },
      { fromPath: "/blog/b/", toPath: "/dead/" },
      { fromPath: "/blog/c/", toPath: "/boom/" },
    ];
    const report = await checkRedirectTargets(redirects, deps({ probe }));
    expect(report.checkedTargets).toBe(3);
    const brokenTargets = report.broken.map((b) => b.target).sort();
    expect(brokenTargets).toEqual([
      "https://www.headout.com/boom/",
      "https://www.headout.com/dead/",
    ]);
    const netErr = report.broken.find((b) => b.target.includes("boom"));
    expect(netErr?.status).toBeNull();
  });

  it("de-duplicates targets so a shared destination is checked once", async () => {
    const probe = vi.fn(async () => ({ ok: false, status: 410 }));
    const redirects: RedirectInput[] = [
      { fromPath: "/blog/x/", toPath: "/retired/" },
      { fromPath: "/blog/y/", toPath: "/retired/" },
    ];
    const report = await checkRedirectTargets(redirects, deps({ probe }));
    expect(probe).toHaveBeenCalledTimes(1);
    expect(report.checkedTargets).toBe(1);
    expect(report.broken[0].fromPaths).toEqual(["/blog/x/", "/blog/y/"]);
    expect(totalBroken(report)).toBe(2);
  });

  it("respects bounded concurrency", async () => {
    let active = 0;
    let peak = 0;
    const probe = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return { ok: true, status: 200 };
    });
    const redirects: RedirectInput[] = Array.from({ length: 10 }, (_, i) => ({
      fromPath: `/blog/p${i}/`,
      toPath: `/dest-${i}/`,
    }));
    await checkRedirectTargets(redirects, deps({ probe, concurrency: 3 }));
    expect(peak).toBeLessThanOrEqual(3);
  });
});

describe("formatHealthDigest", () => {
  it("produces an all-clear digest with no broken targets", async () => {
    const report = await checkRedirectTargets(
      [{ fromPath: "/blog/a/", toPath: "/blog/live/" }],
      deps({ onBlogExists: () => true }),
    );
    const digest = formatHealthDigest(report);
    expect(digest.subject).toMatch(/all targets OK/i);
    expect(digest.text).toMatch(/All clear/);
  });

  it("lists each broken target with its old paths", async () => {
    const report = await checkRedirectTargets(
      [
        { fromPath: "/blog/a/", toPath: "/retired/" },
        { fromPath: "/blog/b/", toPath: "/retired/" },
      ],
      deps({ probe: async () => ({ ok: false, status: 404 }) }),
    );
    const digest = formatHealthDigest(report);
    expect(digest.subject).toBe("Redirect health: 2 broken target(s)");
    expect(digest.text).toContain("https://www.headout.com/retired/");
    expect(digest.text).toContain("from: /blog/a/");
    expect(digest.text).toContain("from: /blog/b/");
  });
});

describe("shouldNotify", () => {
  it("notifies when broken; quiet on clean unless notifyOnClean", async () => {
    const broken = await checkRedirectTargets(
      [{ fromPath: "/blog/a/", toPath: "/dead/" }],
      deps({ probe: async () => ({ ok: false, status: 404 }) }),
    );
    const clean = await checkRedirectTargets(
      [{ fromPath: "/blog/a/", toPath: "/blog/live/" }],
      deps({ onBlogExists: () => true }),
    );
    expect(shouldNotify(broken, false)).toBe(true);
    expect(shouldNotify(clean, false)).toBe(false);
    expect(shouldNotify(clean, true)).toBe(true);
  });
});

describe("parseRecipients", () => {
  it("splits on commas, semicolons and whitespace", () => {
    expect(parseRecipients("a@x.com, b@x.com;c@x.com d@x.com")).toEqual([
      "a@x.com",
      "b@x.com",
      "c@x.com",
      "d@x.com",
    ]);
    expect(parseRecipients(undefined)).toEqual([]);
    expect(parseRecipients("  ")).toEqual([]);
  });
});

describe("resolveEmailConfig", () => {
  it("is disabled when no recipients are configured", () => {
    expect(resolveEmailConfig({}).kind).toBe("disabled");
  });

  it("errors when recipients are set but SMTP host is missing", () => {
    const r = resolveEmailConfig({ REDIRECT_HEALTH_EMAIL_TO: "a@x.com" });
    expect(r.kind).toBe("error");
  });

  it("errors when no sender can be derived", () => {
    const r = resolveEmailConfig({
      REDIRECT_HEALTH_EMAIL_TO: "a@x.com",
      REDIRECT_HEALTH_SMTP_HOST: "smtp.x.com",
    });
    expect(r.kind).toBe("error");
  });

  it("builds a config, defaulting port 587 / STARTTLS and sender to SMTP user", () => {
    const r = resolveEmailConfig({
      REDIRECT_HEALTH_EMAIL_TO: "a@x.com, b@x.com",
      REDIRECT_HEALTH_SMTP_HOST: "smtp.x.com",
      REDIRECT_HEALTH_SMTP_USER: "user@x.com",
      REDIRECT_HEALTH_SMTP_PASS: "secret",
    });
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.config).toMatchObject({
      host: "smtp.x.com",
      port: 587,
      secure: false,
      user: "user@x.com",
      from: "user@x.com",
      to: ["a@x.com", "b@x.com"],
    });
  });

  it("infers implicit TLS on port 465 and honours an explicit secure flag", () => {
    const tls465 = resolveEmailConfig({
      REDIRECT_HEALTH_EMAIL_TO: "a@x.com",
      REDIRECT_HEALTH_SMTP_HOST: "smtp.x.com",
      REDIRECT_HEALTH_EMAIL_FROM: "noreply@x.com",
      REDIRECT_HEALTH_SMTP_PORT: "465",
    });
    expect(tls465.kind === "ok" && tls465.config.secure).toBe(true);

    const explicit = resolveEmailConfig({
      REDIRECT_HEALTH_EMAIL_TO: "a@x.com",
      REDIRECT_HEALTH_SMTP_HOST: "smtp.x.com",
      REDIRECT_HEALTH_EMAIL_FROM: "noreply@x.com",
      REDIRECT_HEALTH_SMTP_PORT: "2525",
      REDIRECT_HEALTH_SMTP_SECURE: "true",
    });
    expect(explicit.kind === "ok" && explicit.config.secure).toBe(true);
  });
});
