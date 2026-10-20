export function monthId(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

const WEEKDAY_LABELS = ["Su", "M", "T", "W", "Th", "F", "S"] as const;

export function weekdayIndex(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day).getDay();
}

/** Sunday is Su and Thursday is Th, so those days are not both S or both T. */
export function weekdayLabel(year: number, month: number, day: number): string {
  return WEEKDAY_LABELS[weekdayIndex(year, month, day)] ?? "";
}

export function isWeekend(year: number, month: number, day: number): boolean {
  const weekday = weekdayIndex(year, month, day);
  return weekday === 0 || weekday === 6;
}

export function currentMonth(now = new Date()): { year: number; month: number; id: string } {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return { year, month, id: monthId(year, month) };
}

/** The calendar month after this one. December rolls into January. */
export function nextMonth(now = new Date()): { year: number; month: number; id: string } {
  const current = currentMonth(now);
  if (current.month === 12) {
    return { year: current.year + 1, month: 1, id: monthId(current.year + 1, 1) };
  }
  return { year: current.year, month: current.month + 1, id: monthId(current.year, current.month + 1) };
}

export function dateFor(year: number, month: number, day: number): string {
  return `${monthId(year, month)}-${String(day).padStart(2, "0")}`;
}

/** A cross belongs on a day that has passed since the month was started. Today and the days before the start stay blank. */
export function shouldWrapDate(date: string, startedOn: string, today: string): boolean {
  return date >= startedOn && date < today;
}

/** The next calendar day, or null on the last day of the month. */
export function nextDateInSameMonth(date: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day >= daysInMonth(year, month)) return null;
  return dateFor(year, month, day + 1);
}

export function monthTitle(year: number, month: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

export function assertDay(year: number, month: number, day: number): string {
  const last = daysInMonth(year, month);
  if (!Number.isInteger(day) || day < 1 || day > last) {
    throw new Error("That day is not in this month.");
  }
  return dateFor(year, month, day);
}
