import { dateFor } from "./month";
import { formatClock12 } from "./time";
import type { DayRecord, Entry, MonthState, TickOutcome } from "./types";

function blank(habitId: string, date: string, display: string, hour: number | null, minute: number | null): DayRecord {
  return {
    habitId,
    date,
    display,
    source: "manual",
    clockHour: hour,
    clockMinute: minute,
    note: null,
    photoPath: null,
    diaryMark: false,
    checklist: [],
    voicePath: null,
  };
}

/**
 * The next grid mark, before any save.
 * Blank becomes a tick, a tick becomes a cross, anything else clears the cell.
 */
export function cycleTickMonth(
  month: MonthState,
  habitId: string,
  date: string,
): { month: MonthState; outcome: TickOutcome } {
  const index = month.records.findIndex((record) => record.habitId === habitId && record.date === date);
  const existing = index >= 0 ? month.records[index] : undefined;
  if (!existing) {
    return {
      month: { ...month, records: month.records.concat([blank(habitId, date, "tick", null, null)]) },
      outcome: "tick",
    };
  }
  if (existing.display === "tick") {
    const records = month.records.slice();
    records[index] = { ...existing, display: "cross", source: "manual", clockHour: null, clockMinute: null };
    return { month: { ...month, records }, outcome: "cross" };
  }
  return {
    month: { ...month, records: month.records.filter((_, item) => item !== index) },
    outcome: "empty",
  };
}

/** Home's Done mark, before any save. A tick that is already there stays put. */
export function paintDoneToday(month: MonthState, habitId: string, entry: Entry, now: Date): MonthState | null {
  if (entry !== "tick" && entry !== "timer") return null;
  if (month.year !== now.getFullYear() || month.month !== now.getMonth() + 1) return null;
  const date = dateFor(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const index = month.records.findIndex((record) => record.habitId === habitId && record.date === date);
  const existing = index >= 0 ? month.records[index] : undefined;
  if (entry === "tick" && existing?.display === "tick") return null;
  const hour = entry === "timer" ? now.getHours() : null;
  const minute = entry === "timer" ? now.getMinutes() : null;
  const display = entry === "tick" ? "tick" : formatClock12(now.getHours(), now.getMinutes());
  const next = existing
    ? { ...existing, display, source: "manual" as const, clockHour: hour, clockMinute: minute }
    : blank(habitId, date, display, hour, minute);
  const records = month.records.slice();
  if (index >= 0) records[index] = next;
  else records.push(next);
  return { ...month, records };
}
