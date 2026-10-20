import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import type { FollowUpRequest, NotifyResult, ReminderRequest } from "./notify";
import { reminderBody } from "./reminderCopy";
import { reminderInstants } from "./reminderWhen";

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

function reminderId(habitId: string, day?: string): string {
  return day ? `pencheck-reminder-${habitId}-${day}` : `pencheck-reminder-${habitId}`;
}

function dayKey(when: Date): string {
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${when.getFullYear()}-${month}-${day}`;
}

async function cancelReminderSeries(habitId: string): Promise<void> {
  const prefix = `pencheck-reminder-${habitId}`;
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

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: "MyDTC",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

async function alertsAllowed(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (canAlert(current)) return true;
  const asked = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: false,
      allowSound: true,
    },
  });
  return canAlert(asked);
}

function canAlert(status: Notifications.NotificationPermissionsStatus): boolean {
  const ios = status.ios;
  if (ios) {
    return (
      ios.status === Notifications.IosAuthorizationStatus.AUTHORIZED && ios.allowsAlert !== false
    );
  }
  return status.granted;
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
    if (!(await alertsAllowed())) return "unavailable";
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
  await cancelReminderSeries(request.habitId);
  if (request.hour == null || request.minute == null) return "cancelled";
  if (!Number.isInteger(request.hour) || !Number.isInteger(request.minute)) return "unavailable";
  if (request.hour < 0 || request.hour > 23 || request.minute < 0 || request.minute > 59) {
    return "unavailable";
  }
  const upcoming = reminderInstants(request.hour, request.minute, new Date(), request.todayWrapped === true);
  if (!upcoming.length) return "unavailable";
  try {
    if (!(await alertsAllowed())) return "unavailable";
    await ensureChannel();
    const body = reminderBody(request.habitName);
    for (const when of upcoming) {
      await Notifications.scheduleNotificationAsync({
        identifier: reminderId(request.habitId, dayKey(when)),
        content: {
          title: "MyDTC",
          body,
          sound: true,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: when,
          channelId: CHANNEL,
        },
      });
    }
    return "scheduled";
  } catch {
    return "unavailable";
  }
}

export async function reminderIsScheduled(habitId: string): Promise<boolean> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const prefix = `pencheck-reminder-${habitId}`;
    return scheduled.some((item) => item.identifier === prefix || item.identifier.startsWith(`${prefix}-`));
  } catch {
    return false;
  }
}

const EVENING_ID = "pencheck-evening-wrap";

/** Evening wrap. Tonight is left off once the day is already closed. */
export async function syncEveningWrap(
  hour: number | null,
  minute: number | null,
  todayWrapped = false,
): Promise<NotifyResult> {
  await cancelId(EVENING_ID);
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((item) => item.identifier === EVENING_ID || item.identifier.startsWith(`${EVENING_ID}-`))
        .map((item) => cancelId(item.identifier)),
    );
  } catch {
    // The plain id above is already cancelled.
  }
  if (hour == null || minute == null) return "cancelled";
  const upcoming = reminderInstants(hour, minute, new Date(), todayWrapped);
  if (!upcoming.length) return "unavailable";
  try {
    if (!(await alertsAllowed())) return "unavailable";
    await ensureChannel();
    for (const when of upcoming) {
      await Notifications.scheduleNotificationAsync({
        identifier: `${EVENING_ID}-${dayKey(when)}`,
        content: {
          title: "MyDTC",
          body: "Wrap up today",
          sound: true,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: when,
          channelId: CHANNEL,
        },
      });
    }
    return "scheduled";
  } catch {
    return "unavailable";
  }
}

export async function cancelHabitNotifications(habitId: string): Promise<void> {
  await cancelReminderSeries(habitId);
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
