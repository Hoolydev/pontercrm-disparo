import type { MultipartFile } from "@fastify/multipart";
import { newId } from "@pointer/shared";
import { getStorage, type StoredFile } from "./storage.js";

export type UploadKind = "image" | "video" | "document";

export function classifyMime(mime: string): UploadKind | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "document";
  if (
    mime.startsWith("application/msword") ||
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "document";
  }
  return null;
}

export async function saveMultipartFile(opts: {
  file: MultipartFile;
  entityType: string;
  entityId: string;
}): Promise<{ stored: StoredFile; kind: UploadKind }> {
  const kind = classifyMime(opts.file.mimetype);
  if (!kind) throw new Error(`Unsupported file type: ${opts.file.mimetype}`);

  const fileId = newId();
  const stored = await getStorage().put({
    entityType: opts.entityType,
    entityId: opts.entityId,
    fileId,
    filename: opts.file.filename,
    mimeType: opts.file.mimetype,
    data: opts.file.file
  });

  return { stored, kind };
}
