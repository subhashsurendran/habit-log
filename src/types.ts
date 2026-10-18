export type Entry = "tick" | "time";

export type Habit = {
  id: string;
  name: string;
  sortOrder: number;
  entry: Entry;
};

export type DayRecord = {
  habitId: string;
  date: string;
  display: string;
  source: "manual";
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
