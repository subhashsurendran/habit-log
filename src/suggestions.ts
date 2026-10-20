import type { Entry } from "./types";

export type HabitSuggestion = {
  name: string;
  entry: Entry;
  line: string;
};

/** Plain habits people keep in many countries. One line each. No local jokes. */
export const HABIT_SUGGESTIONS: readonly HabitSuggestion[] = [
  { name: "Drink water", entry: "tick", line: "A glass with a meal is enough to count." },
  { name: "A short walk", entry: "tick", line: "Ten minutes outside is a full walk." },
  { name: "Read", entry: "tick", line: "A few pages counts." },
  { name: "Stretch", entry: "tick", line: "One minute after you stand up." },
  { name: "Write one line", entry: "journal", line: "One sentence about the day." },
  { name: "Step outside", entry: "tick", line: "Open the door, see daylight, come back." },
  { name: "Tidy one spot", entry: "tick", line: "One surface, then stop." },
  { name: "Call someone", entry: "tick", line: "One real conversation." },
  { name: "Phone outside the room", entry: "tick", line: "The phone charges where you do not sleep." },
  { name: "Quiet minute", entry: "tick", line: "Sit still for one minute." },
  { name: "Fruit or vegetables", entry: "tick", line: "One serving with a meal." },
  { name: "One good thing", entry: "journal", line: "Name one thing that went well." },
  { name: "A little strength", entry: "tick", line: "A few pushups, or one carry, counts." },
  { name: "Learn one thing", entry: "tick", line: "One page or one lesson, then stop." },
];

function kept(existing: readonly string[], suggestion: string): boolean {
  const want = suggestion.trim().toLowerCase();
  return existing.some((name) => {
    const have = name.trim().toLowerCase();
    if (!have || !want) return false;
    if (have === want) return true;
    const shorter = have.length < want.length ? have : want;
    const longer = have.length < want.length ? want : have;
    return shorter.length >= 4 && longer.startsWith(shorter);
  });
}

export function smallerLine(habitName: string): string {
  const match = HABIT_SUGGESTIONS.find((item) => kept([habitName], item.name));
  return match?.line ?? "This week, the smallest version once is enough.";
}
export function suggestionsNotKept(existingNames: readonly string[]): HabitSuggestion[] {
  return HABIT_SUGGESTIONS.filter((item) => !kept(existingNames, item.name));
}

/** The same suggestion all day. Another steps to the next one they do not already keep. */
export function suggestionAt(
  open: readonly HabitSuggestion[],
  shift: number,
  now = new Date(),
): HabitSuggestion | null {
  if (!open.length) return null;
  const start = Date.UTC(now.getFullYear(), 0, 1);
  const day = Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - start) / 86400000);
  const index = (((day + shift) % open.length) + open.length) % open.length;
  return open[index] ?? null;
}
