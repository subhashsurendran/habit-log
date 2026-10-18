export function monthId(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Sunday is 0 and Saturday is 6, matching the local calendar. */
export function isWeekend(year: number, month: number, day: number): boolean {
  const weekday = new Date(year, month - 1, day).getDay();
  return weekday === 0 || weekday === 6;
}

export function currentMonth(now = new Date()): { year: number; month: number; id: string } {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return { year, month, id: monthId(year, month) };
}

export function dateFor(year: number, month: number, day: number): string {
  return `${monthId(year, month)}-${String(day).padStart(2, "0")}`;
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
