import { Directory, File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";

import { keepPhotoFile, PHOTO_REFUSED } from "./photoFile";

const MAX_BASE64 = 1_000_000;

type CreatableDir = Directory & {
  create: (options?: { intermediates?: boolean; idempotent?: boolean }) => void;
};

type WritableFile = File & {
  create: (options?: { overwrite?: boolean }) => void;
  write: (content: Uint8Array) => void;
  delete: () => void;
};

function decodeBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function safePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9-]/g, "");
}

/**
 * Copies one photo into the app document folder. The path is not in the git repo.
 * If the file cannot be saved, the photo is refused. It is never written into the database.
 */
export async function storeJournalPhoto(
  habitId: string,
  date: string,
  base64: string,
): Promise<string> {
  if (!base64 || base64.length > MAX_BASE64) {
    throw new Error("That photo is too large.");
  }
  let file: WritableFile | null = null;
  try {
    if (!Paths.document) throw new Error(PHOTO_REFUSED);
    const folder = new Directory(Paths.document, "pencheck-photos") as CreatableDir;
    if (!folder.exists) folder.create({ intermediates: true, idempotent: true });
    file = new File(folder, `${safePart(habitId)}-${safePart(date)}.jpg`) as WritableFile;
    if (file.exists) file.delete();
    file.create({ overwrite: true });
    file.write(decodeBase64(base64));
    const stored = keepPhotoFile(file.uri);
    if (!stored) {
      try {
        file.delete();
      } catch {
        // The file was not a keeper. Leaving it would not put it in the database.
      }
      throw new Error(PHOTO_REFUSED);
    }
    return stored;
  } catch (error) {
    if (error instanceof Error && error.message === "That photo is too large.") throw error;
    if (error instanceof Error && error.message === PHOTO_REFUSED) throw error;
    try {
      file?.delete();
    } catch {
      // Already gone.
    }
    throw new Error(PHOTO_REFUSED);
  }
}

export async function pickJournalPhoto(habitId: string, date: string): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 0.4,
    base64: true,
  });
  if (result.canceled || !result.assets[0]?.base64) return null;
  return storeJournalPhoto(habitId, date, result.assets[0].base64);
}

export function forgetJournalPhoto(path: string | null): void {
  if (!path || !path.includes("pencheck-photos") || path.startsWith("data:")) return;
  try {
    const file = new File(path) as WritableFile;
    if (file.exists) file.delete();
  } catch {
    // The database row is the source of truth if the file is already gone.
  }
}
