import { dateFor, daysInMonth } from "./month";
import { shownMark } from "./tally";
import type { CheckItem, Entry, MonthState } from "./types";

export type OpenHabit = {
  id: string;
  name: string;
  entry: Entry;
  followUpHours: number | null;
};

export type ScoreFocus = {
  label: string;
  misses: number;
};

export type HabitScoreLine = {
  id: string;
  name: string;
  doneDays: number[];
  missDays: number[];
};

export type MonthScore = {
  done: number;
  miss: number;
  /** Null when done + miss is zero. The screen must not show a percent then. */
  percent: number | null;
  focus: ScoreFocus[];
  /** Habits that closed at least one day, in grid order. View only. */
  lines: HabitScoreLine[];
};

type ScoreHabit = {
  id: string;
  name: string;
  entry: Entry;
  blankCountsAsMiss: boolean;
  tags: readonly string[];
};

type ScoreRecord = {
  habitId: string;
  date: string;
  display?: string;
  note?: string | null;
  photoPath?: string | null;
  diaryMark?: boolean;
  clockHour?: number | null;
  clockMinute?: number | null;
  checklist?: CheckItem[];
};

export type ScoreInput = {
  year: number;
  month: number;
  today: string;
  startedOn: string | null;
  wrappedDates: readonly string[];
  habits: readonly ScoreHabit[];
  records: readonly ScoreRecord[];
};

function checklistComplete(items: CheckItem[] | undefined): boolean {
  return !!items && items.length > 0 && items.every((item) => item.done);
}

function isDone(entry: Entry, cell: ScoreRecord | undefined): boolean {
  const shown = shownMark(entry, cell);
  if (entry === "tick") return shown === "tick";
  if (entry === "timer") return shown === "time";
  if (entry === "journal") {
    return shown === "note" || shown === "photo" || shown === "diary" || shown === "voice";
  }
  if (entry === "checklist") return checklistComplete(cell?.checklist);
  return false;
}

/** A blank before the month was opened is not a closed day. */
function inScoreRange(date: string, startedOn: string | null, today: string): boolean {
  const start = startedOn || today;
  return date >= start && date <= today;
}

function isMiss(
  entry: Entry,
  blankCountsAsMiss: boolean,
  cell: ScoreRecord | undefined,
  date: string,
  today: string,
  wrapped: boolean,
): boolean {
  const shown = shownMark(entry, cell);
  if (shown === "cross") return true;
  if (shown !== "blank") return false;
  const closed = date < today || wrapped;
  return closed && blankCountsAsMiss;
}

function focusLabels(habit: ScoreHabit): string[] {
  const tags = habit.tags.filter((tag) => tag.trim().length > 0);
  if (tags.length) return [...tags];
  const name = habit.name.trim();
  return name ? [name] : [];
}

export function scoreStoredMonth(month: MonthState, now = new Date()): MonthScore {
  return scoreMonth({
    year: month.year,
    month: month.month,
    today: dateFor(now.getFullYear(), now.getMonth() + 1, now.getDate()),
    startedOn: month.startedOn,
    wrappedDates: month.wrappedDates,
    habits: month.habits,
    records: month.records,
  });
}

export function scoreMonth(input: ScoreInput): MonthScore {
  const wrapped = new Set(input.wrappedDates);
  const byCell = new Map<string, ScoreRecord>();
  for (const record of input.records) byCell.set(`${record.habitId}|${record.date}`, record);

  let done = 0;
  let miss = 0;
  const focus = new Map<string, number>();
  const lines: HabitScoreLine[] = [];
  const lastDay = daysInMonth(input.year, input.month);

  for (const habit of input.habits) {
    const doneDays: number[] = [];
    const missDays: number[] = [];
    for (let day = 1; day <= lastDay; day += 1) {
      const date = dateFor(input.year, input.month, day);
      if (!inScoreRange(date, input.startedOn, input.today)) continue;
      const cell = byCell.get(`${habit.id}|${date}`);
      if (isDone(habit.entry, cell)) {
        done += 1;
        doneDays.push(day);
        continue;
      }
      if (!isMiss(habit.entry, habit.blankCountsAsMiss, cell, date, input.today, wrapped.has(date))) {
        continue;
      }
      miss += 1;
      missDays.push(day);
      for (const label of focusLabels(habit)) {
        focus.set(label, (focus.get(label) ?? 0) + 1);
      }
    }
    if (doneDays.length || missDays.length) {
      lines.push({ id: habit.id, name: habit.name, doneDays, missDays });
    }
  }

  const total = done + miss;
  return {
    done,
    miss,
    percent: total === 0 ? null : Math.round((100 * done) / total),
    focus: [...focus.entries()]
      .filter((entry) => entry[1] > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([label, misses]) => ({ label, misses })),
    lines,
  };
}

export function openTodayHabits(month: MonthState, now = new Date()): OpenHabit[] {
  if (month.year !== now.getFullYear() || month.month !== now.getMonth() + 1) return [];
  const today = dateFor(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const byCell = new Map<string, ScoreRecord>();
  for (const record of month.records) byCell.set(`${record.habitId}|${record.date}`, record);
  return month.habits.flatMap((habit) => {
    const cell = byCell.get(`${habit.id}|${today}`);
    const shown = shownMark(habit.entry, cell);
    if (shown === "cross" || isDone(habit.entry, cell)) return [];
    return [
      {
        id: habit.id,
        name: habit.name,
        entry: habit.entry,
        followUpHours: habit.followUpHours,
      },
    ];
  });
}

function weekStart(today: string): string {
  const parts = today.split("-").map(Number);
  const year = parts[0] ?? 2000;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() - date.getDay());
  return dateFor(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** The one tag with the most misses in the current calendar week. */
export function weeklyFocusTag(
  month: MonthState,
  now = new Date(),
): { label: string; misses: number } | null {
  const today = dateFor(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const start = weekStart(today);
  const wrapped = new Set(month.wrappedDates);
  const byCell = new Map<string, ScoreRecord>();
  for (const record of month.records) byCell.set(`${record.habitId}|${record.date}`, record);
  const counts = new Map<string, number>();
  for (const habit of month.habits) {
    if (!habit.tags.length) continue;
    for (let day = 1; day <= daysInMonth(month.year, month.month); day += 1) {
      const date = dateFor(month.year, month.month, day);
      if (date < start || date > today) continue;
      if (!inScoreRange(date, month.startedOn, today)) continue;
      const cell = byCell.get(`${habit.id}|${date}`);
      if (!isMiss(habit.entry, habit.blankCountsAsMiss, cell, date, today, wrapped.has(date))) continue;
      for (const tag of habit.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  let best: { label: string; misses: number } | null = null;
  for (const [label, misses] of counts) {
    if (!best || misses > best.misses || (misses === best.misses && label.localeCompare(best.label) < 0)) {
      best = { label, misses };
    }
  }
  return best;
}
