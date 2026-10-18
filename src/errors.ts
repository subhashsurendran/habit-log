const GENERIC = "Could not update the log on this device.";

export function errorText(error: unknown): string {
  if (!(error instanceof Error)) return GENERIC;
  const message = error.message.trim();
  if (!message || message.length > 160) return GENERIC;
  if (/sqlite|select |insert |update |delete |pragma/i.test(message)) return GENERIC;
  if (message.includes("/") || message.includes("\\")) return GENERIC;
  return message;
}
