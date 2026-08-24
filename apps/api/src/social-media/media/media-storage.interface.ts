/**
 * Storage-only contract for media bytes — deliberately doesn't know about
 * MediaAsset (the DB row) or public URLs. V1's LocalDiskMediaStorageService
 * is the only implementation; swapping to S3/R2 later means adding a second
 * implementation of this interface, not touching any caller.
 */
export interface SavedMedia {
  storageKey: string;
  sizeBytes: number;
}

export interface MediaStorageService {
  save(input: { buffer: Buffer; orgId: string; filename: string }): Promise<SavedMedia>;
  read(storageKey: string): Promise<Buffer>;
  delete(storageKey: string): Promise<void>;
}

export const MEDIA_STORAGE_SERVICE = Symbol("MEDIA_STORAGE_SERVICE");
