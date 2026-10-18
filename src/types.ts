export type Entry = "tick" | "timer" | "journal" | "checklist";

export type CheckItem = {
  text: string;
  done: boolean;
};

/** v1 writes "manual". "alarm" can be stored later. This app does not create it. */
export type MarkSource = "manual" | "alarm";

export type Habit = {
  id: string;
  name: string;
  sortOrder: number;
  entry: Entry;
  blankCountsAsMiss: boolean;
  /** Whole hours after a tick or a saved time. Null means no follow-up. Journal and checklist rows leave this empty. */
  followUpHours: number | null;
  reminderHour: number | null;
  reminderMinute: number | null;
  tags: string[];
};

export type DayRecord = {
  habitId: string;
  date: string;
  display: string;
  source: MarkSource;
  clockHour: number | null;
  clockMinute: number | null;
  note: string | null;
  photoPath: string | null;
  diaryMark: boolean;
  checklist: CheckItem[];
};

export type MonthState = {
  id: string;
  year: number;
  month: number;
  locked: boolean;
  habits: Habit[];
  records: DayRecord[];
};

export type TickOutcome = "tick" | "cross" | "empty";
