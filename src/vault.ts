import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { decryptAesGcm, encryptAesGcm, equalBytes } from "./aesGcm";
import { OPEN_FAILED } from "./errors";

const KEY_NAME = "habit-log-db-key";
const SEALED_NAME = "habit-log.sealed";
const MAGIC = [0x48, 0x4c, 0x47, 0x31];

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

function sealedFile(): StoredFile | null {
  if (!Paths.document) return null;
  const folder = new Directory(Paths.document, "pencheck-vault") as CreatableDir;
  if (!folder.exists) folder.create({ intermediates: true, idempotent: true });
  return new File(folder, SEALED_NAME) as StoredFile;
}

function bytesToB64(bytes: Uint8Array): string {
  let text = "";
  for (const value of bytes) text += String.fromCharCode(value);
  return globalThis.btoa(text);
}

function b64ToBytes(value: string): Uint8Array {
  const text = globalThis.atob(value);
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
  return bytes;
}

async function webKey(): Promise<Uint8Array> {
  const storage = globalThis.localStorage;
  const existing = storage?.getItem(KEY_NAME);
  if (existing) return b64ToBytes(existing);
  const created = Crypto.getRandomBytes(32);
  storage?.setItem(KEY_NAME, bytesToB64(created));
  return created;
}

export async function databaseKey(): Promise<Uint8Array> {
  if (Platform.OS === "web") return webKey();
  const existing = await SecureStore.getItemAsync(KEY_NAME);
  if (existing) return b64ToBytes(existing);
  const created = Crypto.getRandomBytes(32);
  await SecureStore.setItemAsync(KEY_NAME, bytesToB64(created), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
  return created;
}

export function sealDatabase(plain: Uint8Array, key: Uint8Array): Uint8Array {
  const iv = Crypto.getRandomBytes(12);
  const { cipher, tag } = encryptAesGcm(key, iv, plain);
  const out = new Uint8Array(4 + iv.length + tag.length + cipher.length);
  out.set(MAGIC, 0);
  out.set(iv, 4);
  out.set(tag, 16);
  out.set(cipher, 32);
  return out;
}

export function openDatabaseSeal(sealed: Uint8Array, key: Uint8Array): Uint8Array {
  if (sealed.length < 32 || MAGIC.some((value, index) => sealed[index] !== value)) {
    throw new Error(OPEN_FAILED);
  }
  const iv = sealed.subarray(4, 16);
  const tag = sealed.subarray(16, 32);
  const cipher = sealed.subarray(32);
  return decryptAesGcm(key, iv, cipher, tag);
}

export async function readSealed(): Promise<Uint8Array | null> {
  const file = sealedFile();
  if (!file?.exists) return null;
  return new Uint8Array(await file.arrayBuffer());
}

export async function writeSealed(bytes: Uint8Array): Promise<void> {
  const file = sealedFile();
  if (!file) throw new Error(OPEN_FAILED);
  if (file.exists) file.delete();
  file.create({ overwrite: true });
  file.write(bytes);
  const check = new Uint8Array(await file.arrayBuffer());
  if (!equalBytes(check, bytes)) throw new Error(OPEN_FAILED);
}
