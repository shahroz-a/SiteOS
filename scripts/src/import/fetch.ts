import type { FetchResult } from "./types";

const USER_AGENT =
  "HeadoutMigrationBot/1.0 (+https://www.headout.com/blog; content-migration)";

export interface FetchOptions {
  retries?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
}

/**
 * Fetch a page with retry/backoff and a sane timeout. Non-2xx responses still
 * resolve (so the caller can record the HTTP status as a crawl failure) unless
 * every attempt throws at the network level.
 */
export async function fetchHtml(
  url: string,
  opts: FetchOptions = {},
): Promise<FetchResult> {
  const retries = opts.retries ?? 2;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const retryDelayMs = opts.retryDelayMs ?? 1_000;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml",
          "accept-language": "en-US,en;q=0.9",
        },
      });
      const html = await res.text();
      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return {
        url,
        finalUrl: res.url || url,
        httpStatus: res.status,
        headers,
        html,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(
    `Failed to fetch ${url} after ${retries + 1} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}
