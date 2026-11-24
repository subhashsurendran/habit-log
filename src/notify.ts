export type NotifyResult =
  | "stored"
  | "alarm"
  | "notification"
  | "cancelled"
  | "denied-alarm"
  | "denied-notification"
  | "unavailable";

export type FollowUpRequest = {
  habitId: string;
  habitName: string;
  date: string;
  hours: number | null;
  completed: boolean;
};

export type ReminderRequest = {
  habitId: string;
  habitName: string;
  hour: number | null;
  minute: number | null;
  /** Tonight stays quiet after Wrap up day. Later days are still scheduled. */
  todayWrapped?: boolean;
  /** Ask for permission only when the person sets the time. Opening the app does not ask. */
  prompt?: boolean;
};

/**
 * Web and any build without the native module only store the request.
 * Nothing is scheduled, and nothing is reported as having fired.
 */
export async function syncFollowUp(request: FollowUpRequest): Promise<NotifyResult> {
  if (!request.completed || request.hours == null) return "cancelled";
  return "stored";
}

export async function syncDailyReminder(_request: ReminderRequest): Promise<NotifyResult> {
  if (_request.hour == null || _request.minute == null) return "cancelled";
  return "stored";
}

export async function cancelHabitNotifications(_habitId: string): Promise<void> {}

/** The browser has no alarm permission to miss. */
export async function reminderBlock(): Promise<string | null> {
  return null;
}

/** The browser cannot schedule a notification, so a stored time is never armed. */
export async function reminderIsScheduled(_habitId: string): Promise<boolean> {
  return false;
}

/** One daily reminder. Passing null clears it. A second call replaces the first. */
export async function syncEveningWrap(
  hour: number | null,
  minute: number | null,
  _todayWrapped = false,
  _prompt = false,
): Promise<NotifyResult> {
  if (hour == null || minute == null) return "cancelled";
  return "stored";
}
