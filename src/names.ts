import type { Entry } from "./types";

export const NAME_MAX = 40;

export function cleanName(raw: string): string {
  return raw.replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
}

export function isReservedTimeName(name: string): boolean {
  const normalized = cleanName(name).toLowerCase();
  return normalized === "wake up" || normalized === "sleep time";
}

export function validateName(raw: string): string {
  const name = cleanName(raw);
  if (!name) throw new Error("Give the row a name.");
  if (name.length > NAME_MAX) throw new Error("Use 40 characters or fewer.");
  return name;
}

export function validateCallName(raw: string): string {
  const name = cleanName(raw);
  if (!name) throw new Error("Give a name.");
  if (name.length > NAME_MAX) throw new Error("Use 40 characters or fewer.");
  return name;
}

export function callNameOrNull(value: string | null): string | null {
  if (!value) return null;
  try {
    return validateCallName(value);
  } catch {
    return null;
  }
}

export function entryForName(name: string, chosen: Entry): Entry {
  if (isReservedTimeName(name)) return "timer";
  return chosen;
}

export function testSlug(name: string): string {
  const slug = cleanName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "row";
}
