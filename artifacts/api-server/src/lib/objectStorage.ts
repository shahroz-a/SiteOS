import { Storage, File } from "@google-cloud/storage";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export interface UploadedObject {
  /** App-relative serving URL (`/api/storage/objects/...`). */
  url: string;
  /** Object entity path (e.g. `uploads/<uuid>`). */
  name: string;
  size: number | null;
  contentType: string | null;
  updatedAt: string | null;
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

/**
 * Raised when an uploaded object fails server-side validation (not an image,
 * or larger than {@link MAX_IMAGE_BYTES}). Carries a user-facing message.
 */
export class ObjectValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObjectValidationError";
    Object.setPrototypeOf(this, ObjectValidationError.prototype);
  }
}

/** Max stored image size (10 MB) — kept in lockstep with the CMS client. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Detected raster image format, or `null` when the bytes match no known image. */
export type DetectedImageType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp"
  | "image/avif"
  | "image/bmp"
  | "image/tiff"
  | "image/x-icon";

/**
 * Sniff the leading bytes of a file to decide whether it is a real image.
 * Trusting the client-sent `Content-Type` is not enough — a malicious client
 * can PUT arbitrary bytes under an `image/*` header — so we inspect the magic
 * numbers of the stored object instead. Returns the detected MIME type or
 * `null` if the bytes match no supported raster format.
 *
 * SVG is intentionally NOT accepted: it is XML that can carry inline scripts,
 * and these objects are served back to browsers from a same-origin route.
 */
export function sniffImageType(buf: Buffer): DetectedImageType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    buf.length >= 6 &&
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) &&
    buf[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    if (brand === "avif" || brand === "avis") {
      return "image/avif";
    }
  }
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) {
    return "image/bmp";
  }
  if (
    buf.length >= 4 &&
    ((buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0x00) ||
      (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && buf[3] === 0x2a))
  ) {
    return "image/tiff";
  }
  if (
    buf.length >= 4 &&
    buf[0] === 0x00 &&
    buf[1] === 0x00 &&
    buf[2] === 0x01 &&
    buf[3] === 0x00
  ) {
    return "image/x-icon";
  }
  return null;
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  async downloadObject(file: File, cacheTtlSec: number = 3600): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === "public";

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": (metadata.contentType as string) || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers["Content-Length"] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  /**
   * List the images an editor has previously uploaded (via the presigned-URL
   * flow under `<privateDir>/uploads/`), newest first. Returns app-relative
   * serving URLs (`/api/storage/objects/...`) so they can be reused in a block
   * without re-uploading. Metadata comes straight from the list response — no
   * per-object metadata fetch.
   */
  async listUploadedObjects(): Promise<UploadedObject[]> {
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const { bucketName, objectName } = parseObjectPath(entityDir);
    const base = objectName.endsWith("/") ? objectName : `${objectName}/`;
    const prefix = `${base}uploads/`;

    const bucket = objectStorageClient.bucket(bucketName);
    const [files] = await bucket.getFiles({ prefix });

    const objects: UploadedObject[] = [];
    for (const file of files) {
      // Skip the directory placeholder object some clients create.
      if (file.name.endsWith("/")) continue;
      const entityId = file.name.slice(base.length);
      if (!entityId) continue;
      const sizeRaw = file.metadata.size;
      const size =
        sizeRaw == null || Number.isNaN(Number(sizeRaw))
          ? null
          : Number(sizeRaw);
      objects.push({
        url: `/api/storage/objects/${entityId}`,
        name: entityId,
        size,
        contentType: (file.metadata.contentType as string) ?? null,
        updatedAt:
          (file.metadata.updated as string) ??
          (file.metadata.timeCreated as string) ??
          null,
      });
    }

    // Newest first (ISO timestamps sort lexicographically).
    objects.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    return objects;
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  /**
   * Validate an uploaded object server-side AFTER the direct-to-GCS PUT.
   *
   * The presigned-URL flow means the bytes never pass through this server, so
   * we cannot trust the client's declared size/content-type. This reads the
   * stored object's real size from GCS metadata and sniffs its leading bytes
   * to confirm it is a supported raster image within {@link MAX_IMAGE_BYTES}.
   *
   * On failure the offending object is deleted (best-effort) and an
   * {@link ObjectValidationError} is thrown with a user-facing message. On
   * success the detected content-type is persisted to the object's metadata so
   * the serving route returns the true type rather than whatever the client
   * claimed.
   */
  async validateUploadedImage(
    objectFile: File,
  ): Promise<{ contentType: DetectedImageType; size: number }> {
    const [metadata] = await objectFile.getMetadata();
    const size = Number(metadata.size ?? 0);

    if (size <= 0) {
      await this.deleteObjectQuietly(objectFile);
      throw new ObjectValidationError("Uploaded file is empty.");
    }
    if (size > MAX_IMAGE_BYTES) {
      await this.deleteObjectQuietly(objectFile);
      throw new ObjectValidationError(
        `Image is too large (max ${Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))} MB).`,
      );
    }

    const head = await this.readObjectHead(objectFile, 64);
    const detected = sniffImageType(head);
    if (!detected) {
      await this.deleteObjectQuietly(objectFile);
      throw new ObjectValidationError(
        "Uploaded file is not a supported image (JPEG, PNG, GIF, WebP, AVIF, BMP, TIFF or ICO).",
      );
    }

    if (metadata.contentType !== detected) {
      await objectFile.setMetadata({ contentType: detected });
    }

    return { contentType: detected, size };
  }

  /** Read the first `length` bytes of an object into a Buffer. */
  private async readObjectHead(objectFile: File, length: number): Promise<Buffer> {
    const chunks: Array<Buffer> = [];
    const stream = objectFile.createReadStream({ start: 0, end: length - 1 });
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  /** Delete an object, swallowing errors (used on the validation-failure path). */
  private async deleteObjectQuietly(objectFile: File): Promise<void> {
    try {
      await objectFile.delete({ ignoreNotFound: true });
    } catch {
      // Best-effort cleanup; a leaked object is preferable to masking the
      // original validation error.
    }
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }

  const { signed_url: signedURL } = (await response.json()) as {
    signed_url: string;
  };
  return signedURL;
}
