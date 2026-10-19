export const PHOTO_REFUSED = "The photo could not be saved. The rest of the entry can.";

/** A journal photo is a file on the device. A data URL is never a stored path. */
export function keepPhotoFile(path: string | null | undefined): string | null {
  if (!path) return null;
  const value = path.trim();
  if (!value || value.startsWith("data:")) return null;
  if (!value.includes("pencheck-photos")) return null;
  return value;
}
