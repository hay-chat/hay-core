/**
 * Files a shopper may send from the widget (D8-9). The server enforces the
 * same rules; checking here first saves uploading a file it would refuse.
 */

export const WIDGET_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export const WIDGET_ATTACHMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
] as const;

/** Value for the file input's `accept`. */
export const WIDGET_ATTACHMENT_ACCEPT = WIDGET_ATTACHMENT_TYPES.join(",");

export function isAcceptedAttachmentType(type: string): boolean {
  return (WIDGET_ATTACHMENT_TYPES as readonly string[]).includes(type);
}

export function isImageAttachment(type: string): boolean {
  return type.startsWith("image/");
}

/** File contents as base64, without the `data:...;base64,` prefix. */
export function readFileAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

/** "2.4 MB", "830 KB". */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
