export type NotifyResult = "stored" | "scheduled" | "cancelled" | "unavailable";

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
