import type { CheckItem } from "./types";

export const CHECKLIST_LIMIT = 3;
export const CHECKLIST_DAY_NUDGE = 12;
export const CHECKLIST_MAX = 24;
export const CHECK_ITEM_MAX = 80;

function cleanItem(raw: string): string {
  return raw.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

/** Empty lines are dropped. One list stores at most CHECKLIST_MAX lines. */
export function normalizeChecklist(raw: readonly { text?: string; done?: boolean }[]): CheckItem[] {
  const items: CheckItem[] = [];
  for (const item of raw) {
    const text = cleanItem(item.text ?? "");
    if (!text) continue;
    items.push({ text: text.slice(0, CHECK_ITEM_MAX), done: item.done === true });
    if (items.length >= CHECKLIST_MAX) break;
  }
  return items;
}

/** Other checklist rows on this day, plus the list being edited. */
export function dayTaskTotal(
  otherItems: number,
  editing: readonly { text?: string; done?: boolean }[],
): number {
  const others = Number.isFinite(otherItems) && otherItems > 0 ? Math.floor(otherItems) : 0;
  return others + normalizeChecklist(editing).length;
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

export function sameChecklist(left: readonly CheckItem[], right: readonly CheckItem[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((item, index) => item.text === right[index]?.text && item.done === right[index]?.done);
}

/**
 * Copies unfinished lines onto the next day.
 * Lines already there keep their own done state. Finished lines stay behind.
 * The next day still holds at most three lines.
 */
export function mergeCarriedItems(
  destination: readonly { text?: string; done?: boolean }[],
  incoming: readonly { text?: string; done?: boolean }[],
): CheckItem[] {
  const next = normalizeChecklist(destination);
  const seen = new Set(next.map((item) => item.text.toLowerCase()));
  for (const item of normalizeChecklist(incoming)) {
    if (item.done || next.length >= CHECKLIST_LIMIT) continue;
    const key = item.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push({ text: item.text, done: false });
  }
  return next;
}

/** At least three editor lines. A longer list stays visible. */
export function padChecklist(items: readonly CheckItem[]): CheckItem[] {
  const next = items.map((item) => ({ text: item.text, done: item.done }));
  while (next.length < CHECKLIST_LIMIT) next.push({ text: "", done: false });
  return next;
}
