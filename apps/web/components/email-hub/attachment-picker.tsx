"use client";

import { useRef } from "react";
import type { OutboundAttachmentInput } from "../../lib/api-client";

/** Matches EmailHubService.assertAttachmentsWithinLimit on the backend —
 *  checked here too so a too-large attachment fails at file-picker time,
 *  not after a slow upload and a 400 from the server. */
const MAX_TOTAL_BYTES = 15 * 1024 * 1024;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "🖼️";
  if (ext === "pdf") return "📕";
  if (["doc", "docx"].includes(ext)) return "📝";
  if (["xls", "xlsx", "csv"].includes(ext)) return "📊";
  if (["zip", "rar", "7z"].includes(ext)) return "🗜️";
  return "📎";
}

/** Base64 is ~4/3 the size of the raw bytes — used to estimate a stored
 *  attachment's real size back out without keeping the original File around. */
function decodedSize(contentBase64: string): number {
  return Math.ceil((contentBase64.length * 3) / 4);
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function AttachmentPicker({
  attachments,
  onChange,
  onError,
}: {
  attachments: OutboundAttachmentInput[];
  onChange: (attachments: OutboundAttachmentInput[]) => void;
  onError: (message: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const totalBytes = attachments.reduce((sum, a) => sum + decodedSize(a.contentBase64), 0);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    onError(null);
    const incoming = Array.from(fileList);
    const incomingBytes = incoming.reduce((sum, f) => sum + f.size, 0);
    if (totalBytes + incomingBytes > MAX_TOTAL_BYTES) {
      onError("Attachments can't exceed 15 MB total.");
      return;
    }
    try {
      const encoded = await Promise.all(
        incoming.map(async (file) => ({
          filename: file.name,
          contentType: file.type || undefined,
          contentBase64: await readFileAsBase64(file),
        })),
      );
      onChange([...attachments, ...encoded]);
    } catch {
      onError("Couldn't read one of those files — try again.");
    }
  }

  function removeAt(index: number) {
    onChange(attachments.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-1.5 rounded-md border border-[var(--line)] px-2.5 py-1.5 text-xs text-ink/70 hover:bg-ink/5"
        >
          📎 Attach files
        </button>
        {attachments.length > 0 && (
          <span className="text-[11px] text-ink/40">{formatSize(totalBytes)} of 15 MB</span>
        )}
      </div>
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((a, i) => (
            <span
              key={`${a.filename}-${i}`}
              className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-ink/[0.03] py-1 pl-2.5 pr-1.5 text-[11px] text-ink/70"
            >
              <span>{fileIcon(a.filename)}</span>
              <span className="max-w-[160px] truncate">{a.filename}</span>
              <span className="text-ink/40">({formatSize(decodedSize(a.contentBase64))})</span>
              <button
                type="button"
                onClick={() => removeAt(i)}
                title="Remove attachment"
                className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-ink/40 hover:bg-bad/10 hover:text-bad"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
