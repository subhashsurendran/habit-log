import { Directory, File, Paths } from "expo-file-system";

export const VOICE_REFUSED = "The voice note could not be saved. The rest of the entry can.";

/** A journal voice note is a file on the device. A data URL is never a stored path. */
export function keepVoiceFile(path: string | null | undefined): string | null {
  if (!path) return null;
  const value = path.trim();
  if (!value || value.startsWith("data:")) return null;
  if (!value.includes("pencheck-voice")) return null;
  return value;
}

type CreatableDir = Directory & {
  create: (options?: { intermediates?: boolean; idempotent?: boolean }) => void;
};

type StoredFile = File & {
  exists: boolean;
  create: (options?: { overwrite?: boolean }) => void;
  write: (content: Uint8Array) => void;
  delete: () => void;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

function safePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9-]/g, "");
}

export async function storeVoiceNote(habitId: string, date: string, sourceUri: string): Promise<string> {
  if (!sourceUri || sourceUri.startsWith("data:")) throw new Error(VOICE_REFUSED);
  if (!Paths.document) throw new Error(VOICE_REFUSED);
  const source = new File(sourceUri) as StoredFile;
  const bytes = new Uint8Array(await source.arrayBuffer());
  if (!bytes.length) throw new Error(VOICE_REFUSED);
  const folder = new Directory(Paths.document, "pencheck-voice") as CreatableDir;
  if (!folder.exists) folder.create({ intermediates: true, idempotent: true });
  const file = new File(folder, `${safePart(habitId)}-${safePart(date)}.m4a`) as StoredFile;
  if (file.exists) file.delete();
  file.create({ overwrite: true });
  file.write(bytes);
  const stored = keepVoiceFile(file.uri);
  if (!stored) throw new Error(VOICE_REFUSED);
  return stored;
}
