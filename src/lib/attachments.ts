/** Chat file / image attachments helpers */

import type { ChatAttachment, ChatAttachmentKind } from "../types";

export type { ChatAttachment, ChatAttachmentKind };

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB
const MAX_TEXT_BYTES = 200 * 1024; // 200KB
export const MAX_ATTACH = 4;

export function attachmentId() {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function classify(mime: string, name: string): ChatAttachmentKind {
  if (mime.startsWith("image/")) return "image";
  if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    /\.(txt|md|csv|json|log|ts|tsx|js|jsx|py|rs|css|html|svg)$/i.test(name)
  ) {
    return "text";
  }
  return "file";
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("Failed to read file"));
    r.readAsDataURL(file);
  });
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("Failed to read file"));
    r.readAsText(file);
  });
}

export function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function canAddMore(current: number) {
  return current < MAX_ATTACH;
}

/** Build attachment from a browser File (picker / paste / drop) */
export async function fileToAttachment(file: File): Promise<ChatAttachment> {
  const kind = classify(file.type || "", file.name);
  const base: ChatAttachment = {
    id: attachmentId(),
    name: file.name || "file",
    mime: file.type || "application/octet-stream",
    kind,
    size: file.size,
  };

  if (kind === "image") {
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error(
        `Image too large (max ${MAX_IMAGE_BYTES / 1024 / 1024}MB)`
      );
    }
    base.dataUrl = await readAsDataURL(file);
    if (!base.mime.startsWith("image/") && base.dataUrl.startsWith("data:")) {
      const m = base.dataUrl.match(/^data:([^;]+);/);
      if (m) base.mime = m[1];
    }
    return base;
  }

  if (kind === "text") {
    if (file.size > MAX_TEXT_BYTES) {
      throw new Error(`Text file too large (max ${MAX_TEXT_BYTES / 1024}KB)`);
    }
    base.textContent = await readAsText(file);
    return base;
  }

  // Generic binary — metadata note only
  if (file.size <= MAX_TEXT_BYTES) {
    try {
      const t = await readAsText(file);
      if (/^[\x09\x0A\x0D\x20-\x7E\u0080-\uFFFF]*$/.test(t.slice(0, 200))) {
        base.kind = "text";
        base.textContent = t;
        return base;
      }
    } catch {
      /* ignore */
    }
  }
  base.textContent = `[Attached file: ${file.name} (${formatSize(file.size)}, ${base.mime})]`;
  return base;
}
