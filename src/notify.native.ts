import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import type { FollowUpRequest, NotifyResult, ReminderRequest } from "./notify";

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

function followUpId(habitId: string, date: string): string {
  return `pencheck-followup-${habitId}-${date}`;
}

function reminderId(habitId: string): string {
  return `pencheck-reminder-${habitId}`;
}

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: "MyDTC",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

async function allowed(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

async function cancelId(identifier: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  } catch {
    // Already gone.
  }
}

export async function syncFollowUp(request: FollowUpRequest): Promise<NotifyResult> {
  await cancelId(followUpId(request.habitId, request.date));
  if (!request.completed || request.hours == null) return "cancelled";
  try {
    if (!(await allowed())) return "unavailable";
    await ensureChannel();
    const when = new Date(Date.now() + request.hours * 60 * 60 * 1000);
    await Notifications.scheduleNotificationAsync({
      identifier: followUpId(request.habitId, request.date),
      content: {
        title: "MyDTC",
        body: request.habitName,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: when,
        channelId: CHANNEL,
      },
    });
    return "scheduled";
  } catch {
    return "unavailable";
  }
}

export async function syncDailyReminder(request: ReminderRequest): Promise<NotifyResult> {
  await cancelId(reminderId(request.habitId));
  if (request.hour == null || request.minute == null) return "cancelled";
  try {
    if (!(await allowed())) return "unavailable";
    await ensureChannel();
    await Notifications.scheduleNotificationAsync({
      identifier: reminderId(request.habitId),
      content: {
        title: "MyDTC",
        body: request.habitName,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: request.hour,
        minute: request.minute,
        channelId: CHANNEL,
      },
    });
    return "scheduled";
  } catch {
    return "unavailable";
  }
}

const EVENING_ID = "pencheck-evening-wrap";

/** One local daily notification. The same id is replaced, so they do not stack. */
export async function syncEveningWrap(hour: number | null, minute: number | null): Promise<NotifyResult> {
  await cancelId(EVENING_ID);
  if (hour == null || minute == null) return "cancelled";
  try {
    if (!(await allowed())) return "unavailable";
    await ensureChannel();
    await Notifications.scheduleNotificationAsync({
      identifier: EVENING_ID,
      content: {
        title: "MyDTC",
        body: "Wrap up today",
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
        channelId: CHANNEL,
      },
    });
    return "scheduled";
  } catch {
    return "unavailable";
  }
}

export async function cancelHabitNotifications(habitId: string): Promise<void> {
  await cancelId(reminderId(habitId));
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
