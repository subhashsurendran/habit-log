import type { CheckItem } from "./types";

export const CHECKLIST_LIMIT = 3;
export const CHECK_ITEM_MAX = 80;

function cleanItem(raw: string): string {
  return raw.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

/** A checklist cell holds up to three lines for that day. Empty lines are dropped. */
export function normalizeChecklist(raw: readonly { text?: string; done?: boolean }[]): CheckItem[] {
  const items: CheckItem[] = [];
  for (const item of raw) {
    const text = cleanItem(item.text ?? "");
    if (!text) continue;
    items.push({ text: text.slice(0, CHECK_ITEM_MAX), done: item.done === true });
    if (items.length >= CHECKLIST_LIMIT) break;
  }
  return items;
}

export function parseStoredChecklist(value: string | null): CheckItem[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return normalizeChecklist(
      parsed.filter((item): item is { text?: string; done?: boolean } => !!item && typeof item === "object"),
    );
  } catch {
    return [];
  }
}

export function checklistSummary(items: readonly CheckItem[]): string {
  if (!items.length) return "";
  const done = items.filter((item) => item.done).length;
  return `${done}/${items.length}`;
}

/** Three editor lines. Empty lines stay so the user can type into them. */
export function padChecklist(items: readonly CheckItem[]): CheckItem[] {
  const next = items.slice(0, CHECKLIST_LIMIT).map((item) => ({ text: item.text, done: item.done }));
  while (next.length < CHECKLIST_LIMIT) next.push({ text: "", done: false });
  return next;
}
