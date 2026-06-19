/**
 * Direct-to-object-storage image upload for the block editor.
 *
 * Two-step presigned-URL flow:
 *   1. POST /api/storage/uploads/request-url (JSON metadata) -> { uploadURL, objectPath }
 *   2. PUT the file bytes directly to the presigned `uploadURL` (GCS).
 *
 * The returned value is the app-relative serving URL built from `objectPath`
 * (`/api/storage` + objectPath). It is stored on the block as the image `src`
 * and renders in the canvas, the live preview and the public blog — all of
 * which fetch images through the shared `/api` proxy.
 */
import { useCallback, useState } from "react";
import { requestUploadUrl, finalizeUpload } from "@workspace/api-client-react";

/** Max upload size (10 MB) — kept in lockstep with the server-side guard. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export class ImageUploadError extends Error {
  readonly name = "ImageUploadError";
}

function servingUrl(objectPath: string): string {
  // objectPath already starts with `/objects/...`; the serving route lives at
  // `/api/storage/objects/...`, so prepend `/api/storage` (no extra `/objects`).
  return `/api/storage${objectPath}`;
}

/**
 * PUT the file bytes to the presigned URL via XHR so we can report real upload
 * progress (`fetch` has no upload-progress events). Resolves once GCS accepts
 * the bytes; rejects with an `ImageUploadError` on transport failure.
 */
function putWithProgress(
  uploadURL: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadURL);
    xhr.setRequestHeader("Content-Type", file.type);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        reject(new ImageUploadError(`Upload failed (HTTP ${xhr.status}).`));
      }
    };
    xhr.onerror = () =>
      reject(new ImageUploadError("Upload failed. Please check your connection."));
    xhr.onabort = () => reject(new ImageUploadError("Upload cancelled."));

    xhr.send(file);
  });
}

/**
 * Upload a single image file, returning its app-relative serving URL.
 *
 * Flow: request a presigned URL → PUT the bytes directly to GCS (reporting
 * progress) → ask the server to validate the stored object (real size + magic
 * bytes) before the URL is committed to a block. Throws `ImageUploadError` on
 * validation or transport failure.
 */
export async function uploadImage(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new ImageUploadError("Please choose an image file.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ImageUploadError("Image is too large (max 10 MB).");
  }

  const { uploadURL, objectPath } = await requestUploadUrl({
    name: file.name,
    size: file.size,
    contentType: file.type,
  });

  await putWithProgress(uploadURL, file, onProgress);

  // Server-side guard: confirms the stored object is really an image within
  // the size cap (and deletes it otherwise). A 400 surfaces the server's
  // message to the editor.
  try {
    await finalizeUpload({ objectPath });
  } catch (err) {
    throw new ImageUploadError(
      extractServerError(err) ?? "Uploaded file was rejected by the server.",
    );
  }

  return servingUrl(objectPath);
}

/** Best-effort pull of the `{ error }` message out of a failed customFetch. */
function extractServerError(err: unknown): string | null {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: unknown }).data;
    if (data && typeof data === "object" && "error" in data) {
      const message = (data as { error?: unknown }).error;
      if (typeof message === "string" && message.length > 0) return message;
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return null;
}

export interface UseImageUpload {
  upload: (file: File) => Promise<string>;
  isUploading: boolean;
  /** Upload progress 0–100 while a PUT is in flight; null when idle. */
  progress: number | null;
  error: string | null;
}

/** Hook wrapper around {@link uploadImage} that tracks in-flight + progress + error state. */
export function useImageUpload(): UseImageUpload {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(async (file: File): Promise<string> => {
    setIsUploading(true);
    setProgress(0);
    setError(null);
    try {
      return await uploadImage(file, setProgress);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Upload failed. Please try again.";
      setError(message);
      throw err;
    } finally {
      setIsUploading(false);
      setProgress(null);
    }
  }, []);

  return { upload, isUploading, progress, error };
}
