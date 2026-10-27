import * as Application from "expo-application";
import Constants from "expo-constants";
import { Linking } from "react-native";

/**
 * The only address Write to us opens.
 * It is the public support mailbox for mydtc-app.com.
 */
export const WRITE_TO = "support@mydtc-app.com";

const ADDRESS = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** Build stamped on the installed app, then the number in app config. */
export function appBuild(): string {
  const native = Application.nativeBuildVersion?.trim();
  if (native) return native;
  const configured = Constants.expoConfig?.ios?.buildNumber;
  if (typeof configured === "string" && configured.trim()) return configured.trim();
  return "0";
}

/**
 * Mail with a subject and an empty note.
 * The habit log, photos, and backup are not part of the link.
 */
export function writeToUsUrl(build = appBuild()): string {
  const address = WRITE_TO.trim();
  if (!ADDRESS.test(address) || /[\r\n]/.test(build)) {
    throw new Error("closed");
  }
  const subject = encodeURIComponent(`MyDTC build ${build.trim() || "0"}`);
  return `mailto:${address}?subject=${subject}`;
}

export async function openWriteToUs(): Promise<void> {
  await Linking.openURL(writeToUsUrl());
}
