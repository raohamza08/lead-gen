"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "../../../../lib/api-client";
import { SectionCard } from "../../../../components/chart-kit";

interface MediaAsset {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdAt: string;
}

interface MediaFolder {
  id: string;
  name: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Media library (Part: Media Library) — upload once, reuse across posts (the composer pulls from this same list). */
export default function MediaLibraryPage() {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [folders, setFolders] = useState<MediaFolder[]>([]);
  const [activeFolder, setActiveFolder] = useState<string | undefined>(undefined);
  const [newFolderName, setNewFolderName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function refresh() {
    api
      .getSocialMedia(activeFolder)
      .then((res) => setAssets(res as MediaAsset[]))
      .catch((err) => setError((err as Error).message));
  }

  useEffect(refresh, [activeFolder]);
  useEffect(() => {
    api
      .getSocialMediaFolders()
      .then((res) => setFolders(res as MediaFolder[]))
      .catch((err) => setError((err as Error).message));
  }, []);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        await api.uploadSocialMedia(file, activeFolder);
      }
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function createFolder() {
    if (!newFolderName.trim()) return;
    try {
      const folder = (await api.createSocialMediaFolder({ name: newFolderName })) as MediaFolder;
      setFolders((f) => [...f, folder]);
      setNewFolderName("");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this file? Posts already published keep their record, but drafts referencing it will lose the attachment.")) return;
    try {
      await api.deleteSocialMedia(id);
      setAssets((a) => a.filter((x) => x.id !== id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Media Library</h1>
          <p className="mt-0.5 text-xs text-ink/50">Images and video, shared across every post you compose.</p>
        </div>
        <label className="rounded-md bg-accent px-4 py-2 text-sm text-white cursor-pointer">
          {uploading ? "Uploading…" : "Upload"}
          <input ref={fileInput} type="file" multiple accept="image/*,video/*" className="hidden" onChange={(e) => handleUpload(e.target.files)} disabled={uploading} />
        </label>
      </div>

      {error && (
        <div className="rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
          {error}
        </div>
      )}

      <SectionCard title="Folders">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setActiveFolder(undefined)}
            className={`rounded-full border px-3 py-1 text-xs ${!activeFolder ? "border-accent bg-accent text-white" : "border-[var(--line)] text-ink/70 hover:bg-ink/5"}`}
          >
            All
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() => setActiveFolder(f.id)}
              className={`rounded-full border px-3 py-1 text-xs ${activeFolder === f.id ? "border-accent bg-accent text-white" : "border-[var(--line)] text-ink/70 hover:bg-ink/5"}`}
            >
              {f.name}
            </button>
          ))}
          <div className="flex items-center gap-1">
            <input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="New folder"
              className="rounded border border-[var(--line)] bg-transparent px-2 py-1 text-xs"
            />
            <button onClick={createFolder} className="rounded border border-[var(--line)] px-2 py-1 text-xs text-ink/70 hover:bg-ink/5">
              Add
            </button>
          </div>
        </div>
      </SectionCard>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {assets.map((a) => (
          <div key={a.id} className="card overflow-hidden">
            {a.mimeType.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.url} alt={a.filename} className="h-28 w-full object-cover" />
            ) : (
              <div className="flex h-28 w-full items-center justify-center bg-ink/5 text-xs text-ink/50">{a.mimeType}</div>
            )}
            <div className="p-2">
              <div className="truncate text-xs text-ink/70" title={a.filename}>
                {a.filename}
              </div>
              <div className="mt-0.5 flex items-center justify-between text-[10px] text-ink/40">
                <span>{formatBytes(a.sizeBytes)}</span>
                <button onClick={() => remove(a.id)} className="text-bad hover:underline">
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
        {assets.length === 0 && <p className="col-span-full py-8 text-center text-sm text-ink/50">No media yet — upload something above.</p>}
      </div>
    </div>
  );
}
