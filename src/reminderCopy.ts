/** Sleep Time is a bedtime reminder. Any other timer uses its name. */
export function reminderBody(habitName: string): string {
  const name = habitName.trim().toLowerCase();
  if (name === "sleep time" || name.startsWith("sleep")) return "It is time to go to bed.";
  const label = habitName.trim();
  return label || "MyDTC";
}
