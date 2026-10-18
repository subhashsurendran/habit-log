import type { CheckItem, Entry } from "./types";

export type ShownMark = "tick" | "cross" | "time" | "note" | "photo" | "diary" | "list" | "blank";

export type CellView = {
  display?: string;
  note?: string | null;
  photoPath?: string | null;
  diaryMark?: boolean;
  clockHour?: number | null;
  clockMinute?: number | null;
  checklist?: CheckItem[];
};

/** What the grid may paint. A timer never shows a tick. A journal done-mark is not a tick. */
export function shownMark(entry: Entry, cell: CellView | undefined): ShownMark {
  if (!cell) return "blank";
  if (entry === "timer") {
    if (cell.display === "cross") return "cross";
    if (cell.display === "tick") return "blank";
    if (cell.clockHour != null && cell.clockMinute != null) return "time";
    if (cell.display && cell.display !== "tick") return "time";
    return "blank";
  }
  if (entry === "journal") {
    if (cell.display === "cross") return "cross";
    if (cell.note) return "note";
    if (cell.photoPath) return "photo";
    if (cell.diaryMark) return "diary";
    return "blank";
  }
  if (entry === "checklist") {
    if (cell.checklist && cell.checklist.length > 0) return "list";
    if (cell.display === "cross") return "cross";
    return "blank";
  }
  if (cell.display === "tick") return "tick";
  if (cell.display === "cross") return "cross";
  if (cell.note) return "note";
  return "blank";
}

/**
 * A drawn cross is a miss. A blank cell is a miss only when the row flag is on.
 * The grid does not draw that miss until the day is wrapped.
 */
export function countsAsMiss(entry: Entry, blankCountsAsMiss: boolean, cell: CellView | undefined): boolean {
  const shown = shownMark(entry, cell);
  if (shown === "cross") return true;
  if (shown === "blank") return blankCountsAsMiss;
  return false;
}
