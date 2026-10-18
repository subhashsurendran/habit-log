export const FOLLOW_UP_QUICK = 8;
export const FOLLOW_UP_MAX = 48;

/** Empty input means no follow-up. Otherwise a whole number from 1 to 48. */
export function parseFollowUpHours(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^[1-9]\d?$/.test(trimmed)) return null;
  const hours = Number(trimmed);
  if (hours < 1 || hours > FOLLOW_UP_MAX) return null;
  return hours;
}
