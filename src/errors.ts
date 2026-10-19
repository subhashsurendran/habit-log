const GENERIC = "Could not update the log on this device.";

export const OPEN_FAILED = "Could not open the log on this device.";

/** A fixed line. The raw database error can carry a path, SQL, or habit text. */
export function logOpenFailed(): void {
  console.error(OPEN_FAILED);
}

export function errorText(error: unknown): string {
  if (!(error instanceof Error)) return GENERIC;
  const message = error.message.trim();
  if (!message || message.length > 160) return GENERIC;
  if (/sqlite|select |insert |update |delete |pragma|constraint|opfs|data:/i.test(message)) return GENERIC;
  if (message.includes("/") || message.includes("\\")) return GENERIC;
  return message;
}
