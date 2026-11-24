import type { Person, Sex } from "./person";
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

const draw: HabitSuggestion = { name: "Draw one picture", entry: "tick", line: "One picture, then stop." };
const play: HabitSuggestion = { name: "Play outside", entry: "tick", line: "Ten minutes of play outside counts." };
const help: HabitSuggestion = { name: "Help at home", entry: "tick", line: "One small job at home." };
const kick: HabitSuggestion = { name: "Kick a ball", entry: "tick", line: "Kick a ball for a few minutes." };
const build: HabitSuggestion = { name: "Build one thing", entry: "tick", line: "Blocks, a model, or one small fix." };
const stand: HabitSuggestion = { name: "Stand and sit", entry: "tick", line: "A few times from a chair counts." };

function reuse(name: string): HabitSuggestion {
  const found = HABIT_SUGGESTIONS.find((item) => item.name === name);
  if (!found) throw new Error("Missing habit suggestion.");
  return found;
}

const water = reuse("Drink water");
const walk = reuse("A short walk");
const read = reuse("Read");
const stretch = reuse("Stretch");
const write = reuse("Write one line");
const step = reuse("Step outside");
const tidy = reuse("Tidy one spot");
const call = reuse("Call someone");
const phone = reuse("Phone outside the room");
const quiet = reuse("Quiet minute");
const fruit = reuse("Fruit or vegetables");
const good = reuse("One good thing");
const strength = reuse("A little strength");
const learn = reuse("Learn one thing");

/** Sex-neutral lists. Different from each other, and from either sex at that age. */
const childOpen: readonly HabitSuggestion[] = [play, help, water, read, tidy, fruit, phone, quiet];
const teenOpen: readonly HabitSuggestion[] = [learn, walk, read, fruit, quiet, write, tidy, step];
const adultOpen: readonly HabitSuggestion[] = [walk, water, stretch, tidy, write, phone, good, learn];
const olderOpen: readonly HabitSuggestion[] = [tidy, step, call, water, read, fruit, quiet, walk];

const childFemale: readonly HabitSuggestion[] = [draw, read, quiet, help, fruit, tidy, water, stretch];
const childMale: readonly HabitSuggestion[] = [kick, build, play, learn, water, step, good, phone];
const teenFemale: readonly HabitSuggestion[] = [stretch, write, call, walk, fruit, quiet, read, water];
const teenMale: readonly HabitSuggestion[] = [strength, learn, phone, tidy, good, step, water, walk];
const adultFemale: readonly HabitSuggestion[] = [stretch, call, write, walk, fruit, quiet, water, phone];
const adultMale: readonly HabitSuggestion[] = [strength, learn, tidy, good, step, read, walk, water];
const olderFemale: readonly HabitSuggestion[] = [stretch, call, write, fruit, quiet, walk, water, step];
const olderMale: readonly HabitSuggestion[] = [stand, read, tidy, good, learn, phone, walk, water];

/** All-ages lists used when sex is set and age is blank. No hard strength work. */
const openFemale: readonly HabitSuggestion[] = [read, walk, quiet, fruit, call, water, stretch, write];
const openMale: readonly HabitSuggestion[] = [step, phone, water, read, tidy, learn, good, walk];

const EXTRA_SUGGESTIONS: readonly HabitSuggestion[] = [draw, play, help, kick, build, stand];

function everySuggestion(): readonly HabitSuggestion[] {
  const seen = new Set<string>();
  const all: HabitSuggestion[] = [];
  for (const item of [...HABIT_SUGGESTIONS, ...EXTRA_SUGGESTIONS]) {
    const key = item.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(item);
  }
  return all;
}

type AgeBand = "open" | "child" | "teen" | "adult" | "older";

function ageBand(age: number | null): AgeBand {
  if (age == null || !Number.isInteger(age) || age < 1 || age > 120) return "open";
  if (age < 13) return "child";
  if (age < 18) return "teen";
  if (age < 60) return "adult";
  return "older";
}

function catalog(band: AgeBand, sex: Sex | null): readonly HabitSuggestion[] {
  if (band === "open" && sex == null) return HABIT_SUGGESTIONS;
  if (band === "open" && sex === "female") return openFemale;
  if (band === "open" && sex === "male") return openMale;
  if (band === "child" && sex == null) return childOpen;
  if (band === "child" && sex === "female") return childFemale;
  if (band === "child" && sex === "male") return childMale;
  if (band === "teen" && sex == null) return teenOpen;
  if (band === "teen" && sex === "female") return teenFemale;
  if (band === "teen" && sex === "male") return teenMale;
  if (band === "adult" && sex == null) return adultOpen;
  if (band === "adult" && sex === "female") return adultFemale;
  if (band === "adult" && sex === "male") return adultMale;
  if (band === "older" && sex == null) return olderOpen;
  if (band === "older" && sex === "female") return olderFemale;
  return olderMale;
}

function withName(list: readonly HabitSuggestion[], name: string | null): HabitSuggestion[] {
  const who = name?.trim() ?? "";
  return list.map((item) => {
    if (!who) return { ...item };
    const rest = `${item.line.charAt(0).toLowerCase()}${item.line.slice(1)}`;
    return { ...item, line: `${who}, ${rest}` };
  });
}

/** Ideas for this phone. The habit name stays plain. The line may use the stored name. */
export function ideasFor(person: Person): HabitSuggestion[] {
  return withName(catalog(ageBand(person.age), person.sex), person.name);
}

export function smallerLine(habitName: string): string {
  const match = everySuggestion().find((item) => kept([habitName], item.name));
  return match?.line ?? "This week, the smallest version once is enough.";
}

export function alreadyKept(existingNames: readonly string[], suggestion: string): boolean {
  return kept(existingNames, suggestion);
}

export function suggestionsNotKept(
  existingNames: readonly string[],
  catalogItems: readonly HabitSuggestion[] = HABIT_SUGGESTIONS,
): HabitSuggestion[] {
  return catalogItems.filter((item) => !kept(existingNames, item.name));
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
