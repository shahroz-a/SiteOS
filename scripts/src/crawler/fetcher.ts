import { DEFAULT_CONFIG, type CrawlerConfig } from "./config";
import type { FetchResult, RedirectHop } from "./types";
import { renderPage } from "./browser";
import { stripNul } from "./util";

/**
 * HTTP fetch with manual redirect following so the full redirect chain (and
 * any loops) is observable. Headout's blog is server-rendered (WordPress), so
 * this path returns complete content even without a browser.
 */
async function httpFetch(url: string, config: CrawlerConfig): Promise<FetchResult> {
  const redirectChain: RedirectHop[] = [];
  const visited = new Set<string>();
  let current = url;

  for (let hop = 0; hop <= config.maxRedirects; hop += 1) {
    if (visited.has(current)) {
      // Redirect loop detected — stop and report the last status.
      return {
        requestedUrl: url,
        finalUrl: current,
        httpStatus: 508,
        html: "",
        redirectChain,
        via: "http",
        httpHeaders: {},
      };
    }
    visited.add(current);

    const res = await fetch(current, {
      redirect: "manual",
      headers: {
        "user-agent": config.userAgent,
        accept: "text/html,application/xhtml+xml,*/*",
      },
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });

    const status = res.status;
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key] = value;
    });

    if (status >= 300 && status < 400) {
      const location = res.headers.get("location");
      if (!location) break;
      const next = new URL(location, current).toString();
      redirectChain.push({ from: current, to: next, status });
      current = next;
      continue;
    }

    // Only HTML is a crawlable page. Non-HTML responses (images, PDFs, …) are
    // returned flagged so the pipeline skips them without decoding the binary
    // body — whose bytes (NULs) would otherwise crash the page insert.
    const contentType = res.headers.get("content-type") ?? "";
    const isHtmlResponse =
      contentType === "" || /text\/html|application\/xhtml\+xml/i.test(contentType);
    if (!isHtmlResponse) {
      return {
        requestedUrl: url,
        finalUrl: current,
        httpStatus: status,
        html: "",
        redirectChain,
        via: "http",
        httpHeaders: headers,
        nonHtml: true,
      };
    }

    const html = stripNul(await res.text());
    return {
      requestedUrl: url,
      finalUrl: current,
      httpStatus: status,
      html,
      redirectChain,
      via: "http",
      httpHeaders: headers,
    };
  }

  // Exceeded max redirects.
  return {
    requestedUrl: url,
    finalUrl: current,
    httpStatus: 310,
    html: "",
    redirectChain,
    via: "http",
    httpHeaders: {},
  };
}

/**
 * Fetch a URL, preferring full browser rendering when available and falling
 * back to HTTP. Throws on hard failures so the queue can retry.
 */
export async function fetchPage(
  url: string,
  config: CrawlerConfig = DEFAULT_CONFIG,
): Promise<FetchResult> {
  if (config.useBrowser) {
    const rendered = await renderPage(url);
    if (rendered) return rendered;
  }
  return httpFetch(url, config);
}
