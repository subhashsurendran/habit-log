import * as Application from "expo-application";
import Constants from "expo-constants";

/**
 * The only address a support note is sent to.
 * It is the public support mailbox for mydtc-app.com.
 */
export const WRITE_TO = "support@mydtc-app.com";

/**
 * FormSubmit's public client endpoint for that mailbox.
 * The address is in the URL. There is no password and no secret in the app.
 * A 2xx JSON body with success true is the only accepted result.
 */
export const SUPPORT_ENDPOINT = "https://formsubmit.co/ajax/support@mydtc-app.com";

const ADDRESS = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const NOTE_MAX = 2000;
const NOT_SENT = "The note was not sent.";

/** Build stamped on the installed app, then the number in app config. */
export function appBuild(): string {
  const native = Application.nativeBuildVersion?.trim();
  if (native) return native;
  const configured = Constants.expoConfig?.ios?.buildNumber;
  if (typeof configured === "string" && configured.trim()) return configured.trim();
  return "0";
}

/** A note worth sending. Line breaks stay. Control characters do not. */
export function cleanSupportNote(raw: string): string | null {
  const note = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").trim();
  if (!note) return null;
  if (note.length > NOTE_MAX) throw new Error("Use 2000 characters or fewer.");
  return note;
}

export function supportAccepted(status: number, body: unknown): boolean {
  if (status < 200 || status >= 300) return false;
  if (!body || typeof body !== "object") return false;
  const success = (body as { success?: unknown }).success;
  return success === true || success === "true";
}

export async function sendSupportNote(raw: string, build = appBuild()): Promise<void> {
  const note = cleanSupportNote(raw);
  if (!note) throw new Error("Write a note before sending.");
  if (!ADDRESS.test(WRITE_TO) || SUPPORT_ENDPOINT !== `https://formsubmit.co/ajax/${WRITE_TO}`) {
    throw new Error(NOT_SENT);
  }
  if (/[\r\n]/.test(build)) throw new Error(NOT_SENT);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(SUPPORT_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: note,
        _subject: `MyDTC build ${build.trim() || "0"}`,
        _captcha: "false",
        _template: "box",
      }),
      signal: controller.signal,
    });
    const body: unknown = await response.json().catch(() => null);
    if (!supportAccepted(response.status, body)) throw new Error(NOT_SENT);
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Write a note before sending.") throw error;
    if (error instanceof Error && error.message === "Use 2000 characters or fewer.") throw error;
    if (error instanceof Error && error.message === NOT_SENT) throw error;
    throw new Error(NOT_SENT);
  } finally {
    clearTimeout(timer);
  }
}
