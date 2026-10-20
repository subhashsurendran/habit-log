import { formatClock12 } from "./time";

const HORIZON_DAYS = 7;
const LEAD_MS = 1500;

/** The next few times this clock should ring. Today is left out once that day is wrapped up. */
export function reminderInstants(
  hour: number,
  minute: number,
  now: Date,
  todayWrapped: boolean,
): Date[] {
  const upcoming: Date[] = [];
  for (let offset = 0; offset < HORIZON_DAYS; offset += 1) {
    if (offset === 0 && todayWrapped) continue;
    const when = new Date(now);
    when.setDate(when.getDate() + offset);
    when.setHours(hour, minute, 0, 0);
    if (when.getTime() <= now.getTime() + LEAD_MS) continue;
    upcoming.push(when);
  }
  return upcoming;
}

export function reminderNote(
  hour: number,
  minute: number,
  now: Date,
  todayWrapped: boolean,
): string {
  const next = reminderInstants(hour, minute, now, todayWrapped)[0];
  const label = formatClock12(hour, minute);
  if (!next) return "The reminder could not be set.";
  const sameDay =
    next.getFullYear() === now.getFullYear() &&
    next.getMonth() === now.getMonth() &&
    next.getDate() === now.getDate();
  if (sameDay) return `Daily reminder set for ${label}.`;
  if (todayWrapped) return "The day is wrapped up, so tonight stays quiet.";
  return `That time has passed. The next nudge is ${label}.`;
}
