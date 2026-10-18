export const TAG_MAX = 24;
export const TAG_COUNT_MAX = 3;
export const TAG_LIMIT_NOTE = "A task can have 3 tags.";

export const ADD_PRESETS: { name: string; tag: string }[] = [
  { name: "Medicine", tag: "tablets" },
  { name: "Supplement", tag: "fitness" },
];

export function cleanTag(raw: string): string {
  return raw.replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
}

/** Tags are labels only. They do not change a tick, a timer, or a journal cell. */
export function normalizeTags(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of raw) {
    const tag = cleanTag(item);
    if (!tag || tag.length > TAG_MAX) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= TAG_COUNT_MAX) break;
  }
  return tags;
}

/** Adds one tag. A fourth tag is refused and the existing tags stay. */
export function nextTags(current: readonly string[], raw: string): { tags: string[]; refused: boolean } {
  const tags = normalizeTags(current);
  const incoming = cleanTag(raw);
  if (!incoming || incoming.length > TAG_MAX) return { tags, refused: false };
  if (tags.some((tag) => tag.toLowerCase() === incoming.toLowerCase())) return { tags, refused: false };
  if (tags.length >= TAG_COUNT_MAX) return { tags, refused: true };
  return { tags: [...tags, incoming], refused: false };
}

export function parseStoredTags(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return normalizeTags(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    return [];
  }
}
