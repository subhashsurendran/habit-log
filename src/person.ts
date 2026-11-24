export type Sex = "female" | "male" | "prefer_not";

export type Person = {
  name: string | null;
  age: number | null;
  sex: Sex | null;
};

const AGE_MAX = 120;

/** A stored age this phone can use. Anything else is treated as blank. */
export function parseStoredAge(value: string | null): number | null {
  if (!value || !/^\d{1,3}$/.test(value)) return null;
  const age = Number(value);
  if (!Number.isInteger(age) || age < 1 || age > AGE_MAX) return null;
  return age;
}

/** A stored sex this phone can use. Prefer not to say is stored. Anything else is blank. */
export function parseStoredSex(value: string | null): Sex | null {
  if (value === "female" || value === "male" || value === "prefer_not") return value;
  return null;
}

/** Blank is allowed. Any other text must be a whole number of years from 1 to 120. */
export function validateAgeDraft(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const age = parseStoredAge(text);
  if (age == null) throw new Error("Use a whole number of years, or leave age blank.");
  return age;
}
