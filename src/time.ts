export type ParsedTime = {
  display: string;
  hour: number;
  minute: number;
};

/**
 * Handwritten times have no colon: 630 is 06:30, 1830 is 18:30.
 * A colon form such as 6:30 is accepted too. The typed text is kept as display.
 */
export function parseTimeInput(raw: string): ParsedTime | null {
  const display = raw.trim();
  const colon = /^(\d{1,2}):(\d{2})$/.exec(display);
  const digits = /^(\d{3,4})$/.exec(display);
  let hour: number;
  let minute: number;

  if (colon) {
    hour = Number(colon[1]);
    minute = Number(colon[2]);
  } else if (digits) {
    const value = digits[1];
    if (value.length === 3) {
      hour = Number(value.slice(0, 1));
      minute = Number(value.slice(1));
    } else {
      hour = Number(value.slice(0, 2));
      minute = Number(value.slice(2));
    }
  } else {
    return null;
  }

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { display, hour, minute };
}

export function formatClock(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export type ClockPeriod = "AM" | "PM";

export function formatClock12(hour: number, minute: number): string {
  const period: ClockPeriod = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

export function to12Hour(hour: number): { hour12: number; period: ClockPeriod } {
  return {
    hour12: hour % 12 === 0 ? 12 : hour % 12,
    period: hour >= 12 ? "PM" : "AM",
  };
}

export function to24Hour(
  hour12: number,
  minute: number,
  period: ClockPeriod,
): { hour: number; minute: number } | null {
  if (!Number.isInteger(hour12) || !Number.isInteger(minute)) return null;
  if (hour12 < 1 || hour12 > 12 || minute < 0 || minute > 59) return null;
  let hour = hour12 % 12;
  if (period === "PM") hour += 12;
  return { hour, minute };
}
