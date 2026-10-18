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
  /** Checklist only. When on, unfinished lines are copied to the next day at wrap. */
  carryForward: boolean;
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
  /** First day the user opened this month. Earlier days stay out of the score. */
  startedOn: string | null;
  wrappedDates: string[];
  habits: Habit[];
  records: DayRecord[];
};

export type TickOutcome = "tick" | "cross" | "empty";
