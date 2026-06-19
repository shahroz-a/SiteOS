import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  streamReextract,
  type ReextractEvent,
} from "../reextract-client";

// `streamReextract` talks to the network via the global `fetch` and reads the
// NDJSON body through `response.body.getReader()`. The suite runs in the node
// env (matching held-back-drawer.test.tsx), so `fetch` is stubbed per-test and
// the response body is a hand-rolled `ReadableStream`-shaped object whose reader
// hands back the byte chunks the test supplies — letting us split NDJSON lines
// across arbitrary chunk boundaries.

const encoder = new TextEncoder();

/** A non-OK Response whose `.json()` resolves to `body`. */
function errorResponseWithJson(status: number, body: unknown): Response {
  return {
    ok: false,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** A non-OK Response whose `.json()` rejects (e.g. an empty/HTML body). */
function errorResponseWithoutJson(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => {
      throw new Error("Unexpected end of JSON input");
    },
  } as unknown as Response;
}

/** An OK Response with a null body (no progress stream). */
function okResponseNoBody(): Response {
  return { ok: true, status: 200, body: null } as unknown as Response;
}

/**
 * An OK Response whose body streams the given byte `chunks` in order. Each
 * `read()` resolves with the next chunk and the last resolves `{ done: true }`,
 * mirroring how a `ReadableStreamDefaultReader` drains.
 */
function okResponseStreaming(chunks: Uint8Array[]): Response {
  let i = 0;
  const reader = {
    read: async () => {
      if (i < chunks.length) {
        return { value: chunks[i++], done: false };
      }
      return { value: undefined, done: true };
    },
  };
  return {
    ok: true,
    status: 200,
    body: { getReader: () => reader },
  } as unknown as Response;
}

function collect(): {
  events: ReextractEvent[];
  onEvent: (event: ReextractEvent) => void;
} {
  const events: ReextractEvent[] = [];
  return { events, onEvent: (event) => events.push(event) };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamReextract — request", () => {
  it("POSTs to the held-back re-extract endpoint with the encoded article id", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(okResponseStreaming([]));
    const { onEvent } = collect();

    await streamReextract("a/b 1", onEvent);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(
      "/api/cms/held-back-articles/a%2Fb%201/reextract",
    );
    expect(init).toMatchObject({
      method: "POST",
      credentials: "include",
      headers: { accept: "application/x-ndjson" },
    });
  });

  it("forwards the abort signal to fetch", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(okResponseStreaming([]));
    const controller = new AbortController();
    const { onEvent } = collect();

    await streamReextract("a1", onEvent, controller.signal);

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init as RequestInit).signal).toBe(controller.signal);
  });
});

describe("streamReextract — non-OK responses", () => {
  it("surfaces the server-sent { error } message from a non-OK JSON body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      errorResponseWithJson(503, { error: "Could not reach the source URL." }),
    );
    const { events, onEvent } = collect();

    await streamReextract("a1", onEvent);

    expect(events).toEqual([
      {
        type: "error",
        code: "http",
        message: "Could not reach the source URL.",
      },
    ]);
  });

  it("falls back to a generic HTTP message when the JSON body has no error field", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(errorResponseWithJson(500, {}));
    const { events, onEvent } = collect();

    await streamReextract("a1", onEvent);

    expect(events).toEqual([
      {
        type: "error",
        code: "http",
        message: "Re-extract failed (HTTP 500).",
      },
    ]);
  });

  it("falls back to a generic HTTP message when the body is not JSON", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(errorResponseWithoutJson(502));
    const { events, onEvent } = collect();

    await streamReextract("a1", onEvent);

    expect(events).toEqual([
      {
        type: "error",
        code: "http",
        message: "Re-extract failed (HTTP 502).",
      },
    ]);
  });
});

describe("streamReextract — missing stream", () => {
  it("emits a no_stream error when an OK response has no body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(okResponseNoBody());
    const { events, onEvent } = collect();

    await streamReextract("a1", onEvent);

    expect(events).toEqual([
      {
        type: "error",
        code: "no_stream",
        message: "The server did not return a progress stream.",
      },
    ]);
  });
});

describe("streamReextract — NDJSON parsing", () => {
  it("parses multi-line NDJSON split across chunk boundaries, in order", async () => {
    const lines = [
      JSON.stringify({ type: "progress", stage: "fetching" }),
      JSON.stringify({ type: "progress", stage: "parsing" }),
      JSON.stringify({
        type: "result",
        pageId: "page-1",
        slug: "some-article",
        url: "https://www.headout.com/blog/some-article/",
        changed: true,
        validationStatus: "pass",
        validationScore: 95,
        pageStatus: "published",
        heldBack: false,
      }),
    ];
    const ndjson = lines.join("\n") + "\n";

    // Split the serialized NDJSON into chunks that deliberately cut through the
    // middle of lines (and a multi-byte boundary mid-token) so the buffering /
    // partial-line reassembly is exercised.
    const bytes = encoder.encode(ndjson);
    const chunks: Uint8Array[] = [];
    const sizes = [10, 7, 25, 13];
    let offset = 0;
    for (const size of sizes) {
      if (offset >= bytes.length) break;
      chunks.push(bytes.slice(offset, offset + size));
      offset += size;
    }
    if (offset < bytes.length) chunks.push(bytes.slice(offset));

    vi.mocked(fetch).mockResolvedValueOnce(okResponseStreaming(chunks));
    const { events, onEvent } = collect();

    await streamReextract("a1", onEvent);

    expect(events).toEqual([
      { type: "progress", stage: "fetching" },
      { type: "progress", stage: "parsing" },
      {
        type: "result",
        pageId: "page-1",
        slug: "some-article",
        url: "https://www.headout.com/blog/some-article/",
        changed: true,
        validationStatus: "pass",
        validationScore: 95,
        pageStatus: "published",
        heldBack: false,
      },
    ]);
  });

  it("emits a final line that arrives without a trailing newline", async () => {
    const ndjson = JSON.stringify({ type: "progress", stage: "storing" });
    vi.mocked(fetch).mockResolvedValueOnce(
      okResponseStreaming([encoder.encode(ndjson)]),
    );
    const { events, onEvent } = collect();

    await streamReextract("a1", onEvent);

    expect(events).toEqual([{ type: "progress", stage: "storing" }]);
  });

  it("ignores blank and malformed JSON lines while still emitting valid events", async () => {
    const ndjson = [
      "",
      "not json at all",
      "{ broken json",
      JSON.stringify({ type: "progress", stage: "validating" }),
      "   ",
      JSON.stringify({ type: "progress", stage: "storing" }),
    ].join("\n");

    vi.mocked(fetch).mockResolvedValueOnce(
      okResponseStreaming([encoder.encode(ndjson)]),
    );
    const { events, onEvent } = collect();

    await streamReextract("a1", onEvent);

    expect(events).toEqual([
      { type: "progress", stage: "validating" },
      { type: "progress", stage: "storing" },
    ]);
  });

  it("drops well-formed JSON lines that are not shaped like events", async () => {
    const ndjson = [
      JSON.stringify({ stage: "no type field" }),
      JSON.stringify("a bare string"),
      JSON.stringify(42),
      JSON.stringify({ type: "progress", stage: "loading" }),
    ].join("\n");

    vi.mocked(fetch).mockResolvedValueOnce(
      okResponseStreaming([encoder.encode(ndjson)]),
    );
    const { events, onEvent } = collect();

    await streamReextract("a1", onEvent);

    expect(events).toEqual([{ type: "progress", stage: "loading" }]);
  });
});
