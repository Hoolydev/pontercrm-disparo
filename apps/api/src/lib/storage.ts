import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";

/**
 * Storage abstraction. Filesystem implementation by default — works for dev
 * and single-host deploys. Production-grade setups should swap for
 * S3/R2/GCS via the same `Storage` interface.
 */
export type StoredFile = {
  storagePath: string; // relative path inside storage root, ex: "agent/<id>/abc.pdf"
  url: string; // public URL the rest of the system embeds (ex: "<API_URL>/files/agent/<id>/abc.pdf")
  filename: string;
  size: number;
  mimeType: string;
};

export interface Storage {
  put(opts: {
    entityType: string;
    entityId: string;
    fileId: string;
    filename: string;
    mimeType: string;
    data: NodeJS.ReadableStream;
  }): Promise<StoredFile>;
  delete(storagePath: string): Promise<void>;
  resolveDiskPath(storagePath: string): string;
  resolvePublicUrl(storagePath: string): string;
}

export function createFilesystemStorage(opts: {
  root: string;
  publicUrlPrefix: string;
}): Storage {
  return {
    async put({ entityType, entityId, fileId, filename, mimeType, data }) {
      const safeName = sanitizeFilename(filename);
      const ext = extname(safeName) || guessExt(mimeType);
      const stored = `${fileId}${ext}`;
      const relPath = join(entityType, entityId, stored);
      const absPath = join(opts.root, relPath);
      await mkdir(dirname(absPath), { recursive: true });

      let bytes = 0;
      const counter = new (await import("node:stream")).Transform({
        transform(chunk: Buffer, _enc, cb) {
          bytes += chunk.length;
          cb(null, chunk);
        }
      });

      await pipeline(data, counter, createWriteStream(absPath));

      return {
        storagePath: relPath,
        url: `${opts.publicUrlPrefix.replace(/\/$/, "")}/${relPath.split("\\").join("/")}`,
        filename: safeName,
        size: bytes,
        mimeType
      };
    },

    async delete(storagePath: string) {
      const absPath = join(opts.root, storagePath);
      if (existsSync(absPath)) {
        await unlink(absPath).catch(() => void 0);
      }
    },

    resolveDiskPath(storagePath: string) {
      return join(opts.root, storagePath);
    },

    resolvePublicUrl(storagePath: string) {
      return `${opts.publicUrlPrefix.replace(/\/$/, "")}/${storagePath.split("\\").join("/")}`;
    }
  };

  function sanitizeFilename(name: string): string {
    return name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 200);
  }

  function guessExt(mime: string): string {
    if (mime.startsWith("image/jpeg")) return ".jpg";
    if (mime.startsWith("image/png")) return ".png";
    if (mime.startsWith("image/webp")) return ".webp";
    if (mime.startsWith("video/mp4")) return ".mp4";
    if (mime.startsWith("video/quicktime")) return ".mov";
    if (mime === "application/pdf") return ".pdf";
    return "";
  }
}

let _storage: Storage | null = null;

export function getStorage(): Storage {
  if (_storage) return _storage;
  const root = process.env.STORAGE_ROOT ?? join(process.cwd(), "uploads");
  const apiUrl = process.env.API_URL ?? "http://localhost:3333";
  const publicUrl =
    process.env.STORAGE_PUBLIC_URL ?? `${apiUrl.replace(/\/$/, "")}/files`;
  _storage = createFilesystemStorage({ root, publicUrlPrefix: publicUrl });
  return _storage;
}
