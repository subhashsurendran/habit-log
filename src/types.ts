export type Entry = "tick" | "time";

/** v1 writes "manual". "alarm" can be stored later. This app does not create it. */
export type MarkSource = "manual" | "alarm";

export type Habit = {
  id: string;
  name: string;
  sortOrder: number;
  entry: Entry;
  blankCountsAsMiss: boolean;
};

export type DayRecord = {
  habitId: string;
  date: string;
  display: string;
  source: MarkSource;
  clockHour: number | null;
  clockMinute: number | null;
};

export type MonthState = {
  id: string;
  year: number;
  month: number;
  locked: boolean;
  habits: Habit[];
  records: DayRecord[];
};
