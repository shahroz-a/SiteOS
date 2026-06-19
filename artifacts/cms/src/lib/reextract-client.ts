/**
 * Client for the streaming re-extract endpoint.
 *
 * `POST /api/cms/held-back-articles/:id/reextract` responds with a streamed
 * NDJSON body (one JSON object per line) rather than a single JSON payload, so
 * it can't use a generated orval hook. This helper reads the stream and invokes
 * `onEvent` for each parsed event as it arrives, resolving once the stream ends.
 */
export type ReextractStage =
  | "loading"
  | "fetching"
  | "parsing"
  | "validating"
  | "storing";

export interface ReextractProgressEvent {
  type: "progress";
  stage: ReextractStage;
}

export interface ReextractResultEvent {
  type: "result";
  pageId: string;
  slug: string;
  url: string;
  changed: boolean;
  validationStatus: "pass" | "warn" | "fail";
  validationScore: number;
  pageStatus: "draft" | "published";
  heldBack: boolean;
}

export interface ReextractErrorEvent {
  type: "error";
  code: string;
  message: string;
}

export type ReextractEvent =
  | ReextractProgressEvent
  | ReextractResultEvent
  | ReextractErrorEvent;

function isReextractEvent(value: unknown): value is ReextractEvent {
  return Boolean(value && typeof value === "object" && "type" in value);
}

export async function streamReextract(
  articleId: string,
  onEvent: (event: ReextractEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(
    `/api/cms/held-back-articles/${encodeURIComponent(articleId)}/reextract`,
    {
      method: "POST",
      credentials: "include",
      headers: { accept: "application/x-ndjson" },
      signal,
    },
  );

  if (!response.ok) {
    let message = `Re-extract failed (HTTP ${response.status}).`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // keep the default message
    }
    onEvent({ type: "error", code: "http", message });
    return;
  }

  if (!response.body) {
    onEvent({
      type: "error",
      code: "no_stream",
      message: "The server did not return a progress stream.",
    });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isReextractEvent(parsed)) onEvent(parsed);
    } catch {
      // ignore malformed line
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      handleLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
  }
  if (buffer.trim()) handleLine(buffer);
}
