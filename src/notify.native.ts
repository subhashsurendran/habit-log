import { requireOptionalNativeModule } from "expo-modules-core";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import type { FollowUpRequest, NotifyResult, ReminderRequest } from "./notify";
import { reminderBody } from "./reminderCopy";
import { ALARM_DENIED, NOTE_DENIED, alarmUuid, skipWeekday } from "./reminderWhen";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type { FollowUpRequest, NotifyResult, ReminderRequest };

const CHANNEL = "pencheck";
const EVENING_ID = "pencheck-evening-wrap";

type AlarmNative = {
  available: () => boolean;
  authorization: () => Promise<string>;
  schedule: (
    id: string,
    hour: number,
    minute: number,
    title: string,
    skipWeekday: number,
    prompt: boolean,
  ) => Promise<string>;
  cancel: (id: string) => Promise<void>;
  armed: (id: string) => Promise<boolean>;
};

function alarmNative(): AlarmNative | null {
  if (Platform.OS !== "ios") return null;
  return requireOptionalNativeModule<AlarmNative>("MydtcAlarm");
}

function alarmKitReady(): boolean {
  try {
    return alarmNative()?.available() === true;
  } catch {
    return false;
  }
}

function followUpId(habitId: string, date: string): string {
  return `pencheck-followup-${habitId}-${date}`;
}

function reminderPrefix(habitId: string): string {
  return `pencheck-reminder-${habitId}`;
}

async function cancelId(identifier: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  } catch {
    // Already gone.
  }
}

async function cancelPrefix(prefix: string): Promise<void> {
  await cancelId(prefix);
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((item) => item.identifier === prefix || item.identifier.startsWith(`${prefix}-`))
        .map((item) => cancelId(item.identifier)),
    );
  } catch {
    // The known id above is already cancelled.
  }
}

async function cancelAlarm(id: string): Promise<void> {
  try {
    await alarmNative()?.cancel(alarmUuid(id));
  } catch {
    // AlarmKit is not in this binary.
  }
}

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: "MyDTC",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

function iosAllowsRing(status: Notifications.NotificationPermissionsStatus): boolean {
  const ios = status.ios;
  if (!ios) return status.granted;
  return (
    ios.status === Notifications.IosAuthorizationStatus.AUTHORIZED &&
    ios.allowsAlert !== false &&
    ios.allowsSound !== false
  );
}

function iosDenied(status: Notifications.NotificationPermissionsStatus): boolean {
  const ios = status.ios;
  if (!ios) return status.status === "denied";
  return (
    ios.status === Notifications.IosAuthorizationStatus.DENIED ||
    ios.allowsAlert === false ||
    ios.allowsSound === false
  );
}

async function notificationRing(prompt: boolean): Promise<"allowed" | "denied" | "unknown"> {
  const current = await Notifications.getPermissionsAsync();
  if (iosAllowsRing(current)) return "allowed";
  if (!prompt) return iosDenied(current) ? "denied" : "unknown";
  const asked = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: false,
      allowSound: true,
    },
  });
  if (iosAllowsRing(asked)) return "allowed";
  return "denied";
}

async function scheduleMinuteNotification(
  prefix: string,
  hour: number,
  minute: number,
  body: string,
  skip: number,
): Promise<void> {
  await cancelPrefix(prefix);
  const content = {
    title: "MyDTC",
    body,
    sound: true as const,
  };
  if (skip === 0) {
    await Notifications.scheduleNotificationAsync({
      identifier: prefix,
      content,
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
        channelId: CHANNEL,
      },
    });
    return;
  }
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    if (weekday === skip) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: `${prefix}-w${weekday}`,
      content,
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday,
        hour,
        minute,
        channelId: CHANNEL,
      },
    });
  }
}

async function ringAtMinute(
  id: string,
  hour: number,
  minute: number,
  body: string,
  skip: number,
  prompt: boolean,
): Promise<NotifyResult> {
  if (alarmKitReady()) {
    const native = alarmNative();
    if (native) {
      try {
        const outcome = await native.schedule(alarmUuid(id), hour, minute, body, skip, prompt);
        if (outcome === "alarm") {
          await cancelPrefix(id.startsWith("pencheck-") ? id : reminderPrefix(id));
          return "alarm";
        }
        if (outcome === "denied") return "denied-alarm";
        if (outcome === "unknown" && prompt) return "denied-alarm";
        if (outcome !== "missing" && outcome !== "unavailable" && outcome !== "unknown") return "unavailable";
      } catch {
        // AlarmKit refused this schedule. A notification can still ring.
      }
      await cancelAlarm(id);
    }
  }
  const ring = await notificationRing(prompt);
  if (ring === "denied") return "denied-notification";
  if (ring !== "allowed") return "unavailable";
  try {
    await ensureChannel();
    const prefix = id === EVENING_ID ? EVENING_ID : reminderPrefix(id);
    await scheduleMinuteNotification(prefix, hour, minute, body, skip);
    return "notification";
  } catch {
    return "unavailable";
  }
}

export async function syncFollowUp(request: FollowUpRequest): Promise<NotifyResult> {
  await cancelId(followUpId(request.habitId, request.date));
  if (!request.completed || request.hours == null) return "cancelled";
  try {
    const ring = await notificationRing(true);
    if (ring === "denied") return "denied-notification";
    if (ring !== "allowed") return "unavailable";
    await ensureChannel();
    const seconds = Math.max(1, Math.round(request.hours * 60 * 60));
    await Notifications.scheduleNotificationAsync({
      identifier: followUpId(request.habitId, request.date),
      content: {
        title: "MyDTC",
        body: request.habitName,
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds,
        repeats: false,
        channelId: CHANNEL,
      },
    });
    return "notification";
  } catch {
    return "unavailable";
  }
}

export async function syncDailyReminder(request: ReminderRequest): Promise<NotifyResult> {
  const prefix = reminderPrefix(request.habitId);
  if (request.hour == null || request.minute == null) {
    await cancelPrefix(prefix);
    await cancelAlarm(request.habitId);
    return "cancelled";
  }
  if (!Number.isInteger(request.hour) || !Number.isInteger(request.minute)) return "unavailable";
  if (request.hour < 0 || request.hour > 23 || request.minute < 0 || request.minute > 59) {
    return "unavailable";
  }
  const now = new Date();
  const skip = skipWeekday(request.hour, request.minute, now, request.todayWrapped === true);
  return ringAtMinute(
    request.habitId,
    request.hour,
    request.minute,
    reminderBody(request.habitName),
    skip,
    request.prompt === true,
  );
}

export async function reminderIsScheduled(habitId: string): Promise<boolean> {
  try {
    if (await alarmNative()?.armed(alarmUuid(habitId))) return true;
  } catch {
    // Notification list below is the other place a reminder can live.
  }
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const prefix = reminderPrefix(habitId);
    return scheduled.some((item) => item.identifier === prefix || item.identifier.startsWith(`${prefix}-`));
  } catch {
    return false;
  }
}

export async function reminderBlock(): Promise<string | null> {
  if (alarmKitReady()) {
    try {
      const auth = await alarmNative()?.authorization();
      if (auth === "denied") return ALARM_DENIED;
      if (auth === "allowed") return null;
    } catch {
      // Fall through to the notification permission.
    }
  }
  try {
    const status = await Notifications.getPermissionsAsync();
    if (iosDenied(status)) return NOTE_DENIED;
  } catch {
    return null;
  }
  return null;
}

/** Evening wrap. Tonight is left off once the day is already closed. */
export async function syncEveningWrap(
  hour: number | null,
  minute: number | null,
  todayWrapped = false,
  prompt = false,
): Promise<NotifyResult> {
  if (hour == null || minute == null) {
    await cancelPrefix(EVENING_ID);
    await cancelAlarm(EVENING_ID);
    return "cancelled";
  }
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return "unavailable";
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "unavailable";
  const skip = skipWeekday(hour, minute, new Date(), todayWrapped);
  return ringAtMinute(EVENING_ID, hour, minute, "Wrap up today", skip, prompt);
}

export async function cancelHabitNotifications(habitId: string): Promise<void> {
  await cancelPrefix(reminderPrefix(habitId));
  await cancelAlarm(habitId);
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const prefix = `pencheck-followup-${habitId}-`;
    await Promise.all(
      scheduled
        .filter((item) => item.identifier.startsWith(prefix))
        .map((item) => cancelId(item.identifier)),
    );
  } catch {
    // The list is best-effort. The known ids above are already cancelled.
  }
}
