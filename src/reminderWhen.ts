import type { NotifyResult } from "./notify";
import { formatClock12 } from "./time";

const LEAD_MS = 1500;

export const ALARM_DENIED = "Allow alarms for MyDTC, or this reminder will not ring.";
export const NOTE_DENIED = "Allow notifications and sounds for MyDTC, or this reminder will not ring.";

/** 0 keeps every day. 1–7 drops that weekday (Sunday is 1) when tonight should stay quiet. */
export function skipWeekday(hour: number, minute: number, now: Date, todayWrapped: boolean): number {
  if (!todayWrapped) return 0;
  const when = new Date(now);
  when.setHours(hour, minute, 0, 0);
  if (when.getTime() <= now.getTime() + LEAD_MS) return 0;
  return now.getDay() + 1;
}

/** Stable UUID for AlarmKit. A habit id that is already a UUID is kept. */
export function alarmUuid(seed: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seed)) {
    return seed.toLowerCase();
  }
  const bytes = new Uint8Array(16);
  let hash = 2166136261;
  const source = `mydtc:${seed}`;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  for (let index = 0; index < 16; index += 1) {
    hash = Math.imul(hash ^ (index + 1), 16777619);
    bytes[index] = (hash >>> 24) & 0xff;
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** What the screen may say. An alarm is AlarmKit. A notification is not the Clock app. */
export function reminderFeedback(
  result: NotifyResult,
  hour: number,
  minute: number,
  now: Date,
  todayWrapped: boolean,
): { text: string; failed: boolean } | null {
  const label = formatClock12(hour, minute);
  const quiet = skipWeekday(hour, minute, now, todayWrapped) !== 0 ? " Tonight stays quiet." : "";
  if (result === "alarm") {
    return {
      text: `Alarm set for ${label}. It rings at that minute even if MyDTC is closed.${quiet}`,
      failed: false,
    };
  }
  if (result === "notification") {
    return {
      text: `Notification set for ${label}. It rings at that minute even if MyDTC is closed.${quiet}`,
      failed: false,
    };
  }
  if (result === "denied-alarm") return { text: ALARM_DENIED, failed: true };
  if (result === "denied-notification") return { text: NOTE_DENIED, failed: true };
  if (result === "stored") return { text: "Saved on this device. The browser will not notify you.", failed: false };
  if (result === "unavailable") return { text: "Saved. The reminder was not scheduled.", failed: true };
  return null;
}
