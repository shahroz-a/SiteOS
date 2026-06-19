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
import { requestUploadUrl } from "@workspace/api-client-react";

/** Max upload size (10 MB) — kept generous but bounded. */
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
 * Upload a single image file, returning its app-relative serving URL.
 * Throws `ImageUploadError` on validation or transport failure.
 */
export async function uploadImage(file: File): Promise<string> {
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

  const put = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!put.ok) {
    throw new ImageUploadError(`Upload failed (HTTP ${put.status}).`);
  }

  return servingUrl(objectPath);
}

export interface UseImageUpload {
  upload: (file: File) => Promise<string>;
  isUploading: boolean;
  error: string | null;
}

/** Hook wrapper around {@link uploadImage} that tracks in-flight + error state. */
export function useImageUpload(): UseImageUpload {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(async (file: File): Promise<string> => {
    setIsUploading(true);
    setError(null);
    try {
      return await uploadImage(file);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Upload failed. Please try again.";
      setError(message);
      throw err;
    } finally {
      setIsUploading(false);
    }
  }, []);

  return { upload, isUploading, error };
}
