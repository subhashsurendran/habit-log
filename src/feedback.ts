import * as Application from "expo-application";
import Constants from "expo-constants";

/**
 * The only address a support note is sent to.
 * It is the public support mailbox for mydtc-app.com.
 */
export const WRITE_TO = "support@mydtc-app.com";

/**
 * FormSubmit's form for that mailbox.
 * A browser post to this address is what FormSubmit answered.
 * There is no password and no secret in the app.
 */
export const SUPPORT_FORM = `https://formsubmit.co/${WRITE_TO}`;

export const ACTIVATE_LINE = "Open the email at support@mydtc-app.com and tap Activate Form.";
export const NOT_SENT = "The note was not sent.";

const NOTE_MAX = 2000;

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The page a WebKit view posts. Same address the activation screen named. */
export function supportFormHtml(note: string, build: string): string {
  const subject = `MyDTC build ${build.trim() || "0"}`;
  return `<!DOCTYPE html><html><body><form id="f" method="POST" action="${SUPPORT_FORM}"><input type="hidden" name="message" value="${escapeHtml(note)}"><input type="hidden" name="_subject" value="${escapeHtml(subject)}"><input type="hidden" name="_captcha" value="false"><input type="hidden" name="_template" value="box"></form><script>document.getElementById("f").submit();</script></body></html>`;
}

export type SupportPage = "wait" | "activate" | "sent" | "failed";

/** What FormSubmit's reply page means. The note itself is not returned. */
export function supportPageResult(text: string): SupportPage {
  const body = text.trim();
  if (body.length < 12) return "wait";
  const lower = body.toLowerCase();
  if (lower.includes("just a moment")) return "failed";
  if (lower.includes("needs activation") || lower.includes("activate form")) return "activate";
  if (lower.includes("make sure you open this page through a web server")) return "failed";
  if (
    lower.includes("your message has been sent") ||
    lower.includes("submission has been received") ||
    lower.includes("thanks for using formsubmit") ||
    /"success"\s*:\s*"?true"?/.test(lower)
  ) {
    return "sent";
  }
  return "wait";
}

export const READ_SUPPORT_PAGE = `
(function () {
  var text = document.body ? document.body.innerText.slice(0, 400) : "";
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(text);
})();
true;
`;
