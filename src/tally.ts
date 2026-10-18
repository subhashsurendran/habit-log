import type { Entry } from "./types";

export type ShownMark = "tick" | "cross" | "time" | "blank";

/** What the grid is allowed to paint. A time cell never shows a tick or a cross. */
export function shownMark(entry: Entry, display: string | undefined): ShownMark {
  if (!display) return "blank";
  if (entry === "time") {
    if (display === "tick" || display === "cross") return "blank";
    return "time";
  }
  if (display === "tick") return "tick";
  if (display === "cross") return "cross";
  return "blank";
}

/**
 * A drawn cross is a miss. A blank cell is a miss only when the row flag is on.
 * The grid does not draw that miss. There is no insight screen in this pass.
 */
export function countsAsMiss(
  entry: Entry,
  blankCountsAsMiss: boolean,
  display: string | undefined,
): boolean {
  const shown = shownMark(entry, display);
  if (shown === "cross") return true;
  if (shown === "blank") return blankCountsAsMiss;
  return false;
}
