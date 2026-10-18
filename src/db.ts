import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";

import { checklistSummary, mergeCarriedItems, normalizeChecklist, parseStoredChecklist, sameChecklist } from "./checklist";
import { parseFollowUpHours } from "./followUp";
import { currentMonth, dateFor, daysInMonth, monthId, nextDateInSameMonth, shouldWrapDate } from "./month";
import { cleanName, entryForName, NAME_MAX, validateName } from "./names";
import { parseStoredTags, normalizeTags } from "./tags";
import { formatClock12, parseTimeInput } from "./time";
import type { CheckItem, DayRecord, Entry, Habit, MarkSource, MonthState, TickOutcome } from "./types";

const TICK_NOTE_MAX = 40;
const JOURNAL_NOTE_MAX = 2000;

const SEED_ROWS: { suffix: string; name: string; entry: Entry }[] = [
  { suffix: "wake-up", name: "Wake up", entry: "timer" },
  { suffix: "meditation", name: "Meditation", entry: "tick" },
  { suffix: "reading", name: "Reading", entry: "tick" },
];

let opening: Promise<SQLiteDatabase> | null = null;
let dbChain: Promise<unknown> = Promise.resolve();

function withDbLock<T>(task: () => Promise<T>): Promise<T> {
  const run = dbChain.then(task, task);
  dbChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * A refresh can still hold the previous database handle. Opening again
 * then fails until that handle is released, so try a few times.
 */
async function openPreparedDatabase(): Promise<SQLiteDatabase> {
  let last: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let db: SQLiteDatabase | null = null;
    try {
      db = await openDatabaseAsync("habit-log.db");
      await prepareDatabase(db);
      return db;
    } catch (error) {
      last = error;
      if (db) await db.closeAsync().catch(() => undefined);
      await wait(200 * (attempt + 1));
    }
  }
  throw last;
}

export function openAppDatabase(): Promise<SQLiteDatabase> {
  if (!opening) {
    opening = openPreparedDatabase().catch((error: unknown) => {
      opening = null;
      throw error;
    });
  }
  return opening;
}

export async function prepareDatabase(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS months (
      id TEXT PRIMARY KEY,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
      started_on TEXT
    );
    CREATE TABLE IF NOT EXISTS habits (
      id TEXT PRIMARY KEY,
      month_id TEXT NOT NULL,
      name TEXT NOT NULL CHECK (length(name) > 0 AND length(name) <= 40),
      sort_order INTEGER NOT NULL,
      entry TEXT NOT NULL CHECK (entry IN ('tick', 'timer', 'journal', 'checklist')),
      blank_counts_as_miss INTEGER NOT NULL DEFAULT 1 CHECK (blank_counts_as_miss IN (0, 1)),
      follow_up_hours INTEGER,
      reminder_hour INTEGER,
      reminder_minute INTEGER,
      tags TEXT NOT NULL DEFAULT '[]',
      carry_forward INTEGER NOT NULL DEFAULT 1 CHECK (carry_forward IN (0, 1)),
      FOREIGN KEY (month_id) REFERENCES months (id),
      CHECK (follow_up_hours IS NULL OR (follow_up_hours BETWEEN 1 AND 48)),
      CHECK (
        (reminder_hour IS NULL AND reminder_minute IS NULL)
        OR (reminder_hour BETWEEN 0 AND 23 AND reminder_minute BETWEEN 0 AND 59)
      )
    );
    CREATE TABLE IF NOT EXISTS day_records (
      habit_id TEXT NOT NULL,
      date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      display TEXT NOT NULL CHECK (length(display) > 0 AND length(display) <= 16),
      source TEXT NOT NULL CHECK (source IN ('manual', 'alarm')),
      clock_hour INTEGER,
      clock_minute INTEGER,
      span_start TEXT,
      span_end TEXT,
      note TEXT,
      photo_path TEXT,
      diary_mark INTEGER NOT NULL DEFAULT 0 CHECK (diary_mark IN (0, 1)),
      checklist TEXT,
      PRIMARY KEY (habit_id, date),
      FOREIGN KEY (habit_id) REFERENCES habits (id) ON DELETE CASCADE,
      CHECK (
        (clock_hour IS NULL AND clock_minute IS NULL)
        OR (clock_hour BETWEEN 0 AND 23 AND clock_minute BETWEEN 0 AND 59)
      ),
      CHECK (span_start IS NULL AND span_end IS NULL)
    );
    CREATE TABLE IF NOT EXISTS wrapped_days (
      month_id TEXT NOT NULL,
      date TEXT NOT NULL,
      PRIMARY KEY (month_id, date)
    );
    CREATE INDEX IF NOT EXISTS habits_month_order ON habits (month_id, sort_order);
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL CHECK (length(name) > 0 AND length(name) <= 40)
    );
    CREATE TABLE IF NOT EXISTS template_rows (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      name TEXT NOT NULL CHECK (length(name) > 0 AND length(name) <= 40),
      sort_order INTEGER NOT NULL,
      entry TEXT NOT NULL CHECK (entry IN ('tick', 'timer', 'journal', 'checklist')),
      blank_counts_as_miss INTEGER NOT NULL CHECK (blank_counts_as_miss IN (0, 1)),
      reminder_hour INTEGER,
      reminder_minute INTEGER,
      tags TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (template_id) REFERENCES templates (id) ON DELETE CASCADE,
      CHECK (
        (reminder_hour IS NULL AND reminder_minute IS NULL)
        OR (reminder_hour BETWEEN 0 AND 23 AND reminder_minute BETWEEN 0 AND 59)
      )
    );
  `);
  await ensureHabitColumns(db);
  await ensureMonthColumns(db);
  await ensureDayColumns(db);
  await ensureTimerEntry(db);
  await ensureChecklistEntry(db);
}

export function loadMonth(db: SQLiteDatabase, now = new Date()): Promise<MonthState> {
  return withDbLock(() => loadMonthNow(db, now));
}

async function loadMonthNow(db: SQLiteDatabase, now = new Date()): Promise<MonthState> {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const id = `${year}-${String(month).padStart(2, "0")}`;
  const today = dateFor(year, month, now.getDate());

  await db.withTransactionAsync(async () => {
    const existing = await db.getFirstAsync<{ id: string }>(
      "SELECT id FROM months WHERE id = ?",
      id,
    );
    if (existing) return;
    await db.runAsync(
      "INSERT INTO months (id, year, month, locked, started_on) VALUES (?, ?, ?, 0, ?)",
      id,
      year,
      month,
      today,
    );
    for (let index = 0; index < SEED_ROWS.length; index += 1) {
      const seed = SEED_ROWS[index];
      await db.runAsync(
        `INSERT INTO habits (
           id, month_id, name, sort_order, entry, blank_counts_as_miss, tags
         ) VALUES (?, ?, ?, ?, ?, 1, '[]')`,
        `${id}-${seed.suffix}`,
        id,
        seed.name,
        index,
        seed.entry,
      );
    }
  });

  await rememberMonthStart(db, id, today);
  await wrapPastDays(db, id, year, month, now);
  await db.runAsync("UPDATE months SET locked = 1 WHERE id < ?", id);
  return readMonth(db, id);
}

export function openMonth(db: SQLiteDatabase, monthId: string, now = new Date()): Promise<MonthState> {
  return withDbLock(() => openMonthNow(db, monthId, now));
}

async function openMonthNow(db: SQLiteDatabase, monthId: string, now = new Date()): Promise<MonthState> {
  const parsed = assertMonthId(monthId);
  const current = currentMonth(now);
  if (parsed.id === current.id) return loadMonthNow(db, now);
  const existing = await db.getFirstAsync<{ id: string }>("SELECT id FROM months WHERE id = ?", parsed.id);
  if (!existing) throw new Error("That month is not stored.");
  return readMonth(db, parsed.id);
}

export type StoredMonth = { id: string; year: number; month: number };
export type HabitTemplate = { id: string; name: string };
export type DashboardState = {
  current: MonthState;
  past: StoredMonth[];
  templates: HabitTemplate[];
};

export function loadDashboard(db: SQLiteDatabase, now = new Date()): Promise<DashboardState> {
  return withDbLock(async () => {
    const current = await loadMonthNow(db, now);
    const past = await db.getAllAsync<{ id: string; year: number; month: number }>(
      "SELECT id, year, month FROM months WHERE id != ? ORDER BY id DESC",
      current.id,
    );
    const templates = await db.getAllAsync<{ id: string; name: string }>(
      "SELECT id, name FROM templates ORDER BY name COLLATE NOCASE ASC, id ASC",
    );
    return {
      current,
      past: past.map((row) => ({ id: row.id, year: Number(row.year), month: Number(row.month) })),
      templates,
    };
  });
}

export function saveHabitTemplate(
  db: SQLiteDatabase,
  monthId: string,
  rawName: string,
): Promise<void> {
  return withDbLock(() => saveHabitTemplateNow(db, monthId, rawName));
}

export function startMonthFromTemplate(
  db: SQLiteDatabase,
  templateId: string,
  now = new Date(),
): Promise<void> {
  return withDbLock(() => startMonthFromTemplateNow(db, templateId, now));
}

async function saveHabitTemplateNow(db: SQLiteDatabase, monthIdValue: string, rawName: string): Promise<void> {
  const parsed = assertMonthId(monthIdValue);
  const name = templateName(rawName);
  const habits = await db.getAllAsync<{
    name: string;
    sort_order: number;
    entry: string;
    blank_counts_as_miss: number;
    reminder_hour: number | null;
    reminder_minute: number | null;
    tags: string | null;
  }>(
    `SELECT name, sort_order, entry, blank_counts_as_miss, reminder_hour, reminder_minute, tags
     FROM habits WHERE month_id = ? ORDER BY sort_order ASC, id ASC`,
    parsed.id,
  );
  if (!habits.length) throw new Error("Add a row before saving a list.");
  const existing = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM templates WHERE lower(name) = lower(?)",
    name,
  );
  await db.withTransactionAsync(async () => {
    const templateId = existing?.id ?? createId();
    if (existing) {
      await db.runAsync("UPDATE templates SET name = ? WHERE id = ?", name, templateId);
      await db.runAsync("DELETE FROM template_rows WHERE template_id = ?", templateId);
    } else {
      await db.runAsync("INSERT INTO templates (id, name) VALUES (?, ?)", templateId, name);
    }
    for (const habit of habits) {
      const entry = asEntry(habit.entry);
      const reminder = entry === "timer" ? reminderPair(habit.reminder_hour, habit.reminder_minute) : null;
      await db.runAsync(
        `INSERT INTO template_rows (
           id, template_id, name, sort_order, entry, blank_counts_as_miss,
           reminder_hour, reminder_minute, tags
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        createId(),
        templateId,
        habit.name,
        Number(habit.sort_order),
        entry,
        Number(habit.blank_counts_as_miss) === 0 ? 0 : 1,
        reminder?.hour ?? null,
        reminder?.minute ?? null,
        JSON.stringify(parseStoredTags(habit.tags)),
      );
    }
  });
}

async function startMonthFromTemplateNow(
  db: SQLiteDatabase,
  templateId: string,
  now: Date,
): Promise<void> {
  if (!/^[A-Za-z0-9-]{8,80}$/.test(templateId)) {
    throw new Error("That list is not stored.");
  }
  const template = await db.getFirstAsync<{ id: string }>("SELECT id FROM templates WHERE id = ?", templateId);
  if (!template) throw new Error("That list is not stored.");
  const current = currentMonth(now);
  const month = await db.getFirstAsync<{ id: string }>("SELECT id FROM months WHERE id = ?", current.id);
  if (!month) throw new Error("This month is not ready.");
  const marks = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM day_records r
     JOIN habits h ON h.id = r.habit_id
     WHERE h.month_id = ?`,
    current.id,
  );
  if (Number(marks?.n ?? 0) > 0) throw new Error("This month already has marks.");
  const rows = await db.getAllAsync<{
    name: string;
    sort_order: number;
    entry: string;
    blank_counts_as_miss: number;
    reminder_hour: number | null;
    reminder_minute: number | null;
    tags: string | null;
  }>(
    `SELECT name, sort_order, entry, blank_counts_as_miss, reminder_hour, reminder_minute, tags
     FROM template_rows WHERE template_id = ? ORDER BY sort_order ASC, id ASC`,
    templateId,
  );
  if (!rows.length) throw new Error("That list is empty.");
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM habits WHERE month_id = ?", current.id);
    for (const row of rows) {
      const entry = entryForName(row.name, asEntry(row.entry));
      const reminder = entry === "timer" ? reminderPair(row.reminder_hour, row.reminder_minute) : null;
      await db.runAsync(
        `INSERT INTO habits (
           id, month_id, name, sort_order, entry, blank_counts_as_miss,
           reminder_hour, reminder_minute, tags
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        createId(),
        current.id,
        row.name,
        Number(row.sort_order),
        entry,
        Number(row.blank_counts_as_miss) === 0 ? 0 : 1,
        reminder?.hour ?? null,
        reminder?.minute ?? null,
        JSON.stringify(parseStoredTags(row.tags)),
      );
    }
  });
}

function templateName(raw: string): string {
  const name = cleanName(raw);
  if (!name) throw new Error("Give the template a name.");
  if (name.length > NAME_MAX) throw new Error("Use 40 characters or fewer.");
  return name;
}

function reminderPair(
  hour: number | null,
  minute: number | null,
): { hour: number; minute: number } | null {
  if (hour == null || minute == null) return null;
  const h = Number(hour);
  const m = Number(minute);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { hour: h, minute: m };
}

function assertMonthId(value: string): { id: string; year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) throw new Error("That month is not stored.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12 || year < 2000 || year > 9999) throw new Error("That month is not stored.");
  return { id: monthId(year, month), year, month };
}

export async function wrapToday(
  db: SQLiteDatabase,
  monthId: string,
  year: number,
  month: number,
  now = new Date(),
): Promise<void> {
  if (now.getFullYear() !== year || now.getMonth() + 1 !== month) return;
  const today = dateFor(year, month, now.getDate());
  const next = nextDateInSameMonth(today);
  await db.withTransactionAsync(async () => {
    const wrapped = await wrapOneDay(db, monthId, today);
    if (!wrapped || !next) return;
    await carryOpenChecklist(db, monthId, [today], next);
  });
}

export async function cycleTick(
  db: SQLiteDatabase,
  monthId: string,
  habitId: string,
  year: number,
  month: number,
  day: number,
): Promise<TickOutcome> {
  const date = dateInMonth(year, month, day);
  const habit = await requireHabit(db, monthId, habitId);
  if (habit.entry !== "tick") throw new Error("This row is not a tick.");

  const existing = await db.getFirstAsync<{ display: string }>(
    "SELECT display FROM day_records WHERE habit_id = ? AND date = ?",
    habitId,
    date,
  );
  if (!existing) {
    await insertMark(db, habitId, date, "tick", null, null);
    return "tick";
  }
  if (existing.display === "tick") {
    await db.runAsync(
      `UPDATE day_records
       SET display = 'cross', source = 'manual', clock_hour = NULL, clock_minute = NULL,
           span_start = NULL, span_end = NULL
       WHERE habit_id = ? AND date = ?`,
      habitId,
      date,
    );
    return "cross";
  }
  await db.runAsync("DELETE FROM day_records WHERE habit_id = ? AND date = ?", habitId, date);
  return "empty";
}

export async function setTickNote(
  db: SQLiteDatabase,
  monthId: string,
  habitId: string,
  year: number,
  month: number,
  day: number,
  raw: string,
): Promise<void> {
  const date = dateInMonth(year, month, day);
  const habit = await requireHabit(db, monthId, habitId);
  if (habit.entry !== "tick") throw new Error("This row is not a tick.");
  const note = cleanNote(raw, TICK_NOTE_MAX);
  const existing = await db.getFirstAsync<{ display: string }>(
    "SELECT display FROM day_records WHERE habit_id = ? AND date = ?",
    habitId,
    date,
  );
  if (!existing || (existing.display !== "tick" && existing.display !== "cross")) {
    throw new Error("Mark the day before adding a note.");
  }
  await db.runAsync("UPDATE day_records SET note = ? WHERE habit_id = ? AND date = ?", note, habitId, date);
}

export async function setTime(
  db: SQLiteDatabase,
  monthId: string,
  habitId: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Promise<void> {
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) throw new Error("Use 6:30 AM or 6:30 PM.");
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) throw new Error("Use 6:30 AM or 6:30 PM.");
  const date = dateInMonth(year, month, day);
  const habit = await requireHabit(db, monthId, habitId);
  if (habit.entry !== "timer") throw new Error("This row is not a timer.");
  await insertMark(db, habitId, date, formatClock12(hour, minute), hour, minute);
}

export async function clearCell(
  db: SQLiteDatabase,
  monthId: string,
  habitId: string,
  year: number,
  month: number,
  day: number,
): Promise<void> {
  const date = dateInMonth(year, month, day);
  await requireHabit(db, monthId, habitId);
  await db.runAsync("DELETE FROM day_records WHERE habit_id = ? AND date = ?", habitId, date);
}

export async function saveJournal(
  db: SQLiteDatabase,
  monthId: string,
  habitId: string,
  year: number,
  month: number,
  day: number,
  rawNote: string,
  photoPath: string | null,
  diaryMark: boolean,
): Promise<void> {
  const date = dateInMonth(year, month, day);
  const habit = await requireHabit(db, monthId, habitId);
  if (habit.entry !== "journal") throw new Error("This row is not a journal.");
  const note = cleanNote(rawNote, JOURNAL_NOTE_MAX);
  const photo = photoPath && photoPath.trim() ? photoPath.trim() : null;
  if (!note && !photo && !diaryMark) {
    await db.runAsync("DELETE FROM day_records WHERE habit_id = ? AND date = ?", habitId, date);
    return;
  }
  const display = note ? "note" : photo ? "photo" : "diary";
  await db.runAsync(
    `INSERT INTO day_records (
       habit_id, date, display, source, clock_hour, clock_minute, span_start, span_end,
       note, photo_path, diary_mark
     ) VALUES (?, ?, ?, 'manual', NULL, NULL, NULL, NULL, ?, ?, ?)
     ON CONFLICT(habit_id, date) DO UPDATE SET
       display = excluded.display,
       source = 'manual',
       clock_hour = NULL,
       clock_minute = NULL,
       span_start = NULL,
       span_end = NULL,
       note = excluded.note,
       photo_path = excluded.photo_path,
       diary_mark = excluded.diary_mark`,
    habitId,
    date,
    display,
    note,
    photo,
    diaryMark ? 1 : 0,
  );
}

export async function saveChecklist(
  db: SQLiteDatabase,
  monthId: string,
  habitId: string,
  year: number,
  month: number,
  day: number,
  rawItems: readonly CheckItem[],
): Promise<void> {
  const date = dateInMonth(year, month, day);
  const habit = await requireHabit(db, monthId, habitId);
  if (habit.entry !== "checklist") throw new Error("This row is not a checklist.");
  const items = normalizeChecklist(rawItems);
  if (!items.length) {
    const existing = await db.getFirstAsync<{ display: string }>(
      "SELECT display FROM day_records WHERE habit_id = ? AND date = ?",
      habitId,
      date,
    );
    if (existing?.display === "cross") return;
    await db.runAsync("DELETE FROM day_records WHERE habit_id = ? AND date = ?", habitId, date);
    return;
  }
  await db.runAsync(
    `INSERT INTO day_records (
       habit_id, date, display, source, clock_hour, clock_minute, span_start, span_end,
       note, photo_path, diary_mark, checklist
     ) VALUES (?, ?, ?, 'manual', NULL, NULL, NULL, NULL, NULL, NULL, 0, ?)
     ON CONFLICT(habit_id, date) DO UPDATE SET
       display = excluded.display,
       source = 'manual',
       clock_hour = NULL,
       clock_minute = NULL,
       span_start = NULL,
       span_end = NULL,
       note = NULL,
       photo_path = NULL,
       diary_mark = 0,
       checklist = excluded.checklist`,
    habitId,
    date,
    checklistSummary(items),
    JSON.stringify(items),
  );
}

export async function addHabit(
  db: SQLiteDatabase,
  monthId: string,
  rawName: string,
  chosen: Entry,
  rawTags: readonly string[],
): Promise<void> {
  const name = validateName(rawName);
  if (chosen !== "tick" && chosen !== "timer" && chosen !== "journal" && chosen !== "checklist") {
    throw new Error("Choose tick, timer, journal, or checklist.");
  }
  const entry = entryForName(name, chosen);
  const tags = JSON.stringify(normalizeTags(rawTags));
  await assertUnlocked(db, monthId);
  const max = await db.getFirstAsync<{ m: number | string | null }>(
    "SELECT MAX(sort_order) AS m FROM habits WHERE month_id = ?",
    monthId,
  );
  const sortOrder = Number(max?.m ?? -1) + 1;
  await db.runAsync(
    `INSERT INTO habits (
       id, month_id, name, sort_order, entry, blank_counts_as_miss, tags
     ) VALUES (?, ?, ?, ?, ?, 1, ?)`,
    createId(),
    monthId,
    name,
    sortOrder,
    entry,
    tags,
  );
}

export async function setHabitTags(
  db: SQLiteDatabase,
  monthId: string,
  habitId: string,
  rawTags: readonly string[],
): Promise<void> {
  await requireHabit(db, monthId, habitId);
  const result = await db.runAsync(
    "UPDATE habits SET tags = ? WHERE id = ? AND month_id = ?",
    JSON.stringify(normalizeTags(rawTags)),
    habitId,
    monthId,
  );
  if (result.changes === 0) throw new Error("That row is gone.");
}

export async function setBlankCountsAsMiss(
  db: SQLiteDatabase,
  monthId: string,
  habitId: string,
  blankCountsAsMiss: boolean,
): Promise<void> {
  await requireHabit(db, monthId, habitId);
  const result = await db.runAsync(
    "UPDATE habits SET blank_counts_as_miss = ? WHERE id = ? AND month_id = ?",
    blankCountsAsMiss ? 1 : 0,
    habitId,
    monthId,
  );
  if (result.changes === 0) throw new Error("That row is gone.");
}

export async function setCarryForward(
  db: SQLiteDatabase,
  monthId: string,
  habitId: string,
  carryForward: boolean,
): Promise<void> {
  const habit = await requireHabit(db, monthId, habitId);
  if (habit.entry !== "checklist") throw new Error("Only a checklist can carry tasks forward.");
  const result = await db.runAsync(
    "UPDATE habits SET carry_forward = ? WHERE id = ? AND month_id = ?",
    carryForward ? 1 : 0,
    habitId,
    monthId,
  );
  if (result.changes === 0) throw new Error("That row is gone.");
}

export async function setFollowUpHours(
  db: SQLiteDatabase,
  monthId: string,
  habitId: string,
  raw: string,
): Promise<number | null> {
  const habit = await requireHabit(db, monthId, habitId);
  if (habit.entry === "journal" || habit.entry === "checklist") {
    throw new Error("This row has no follow-up.");
  }
  const hours = parseFollowUpHours(raw);
  if (raw.trim() && hours == null) throw new Error("Use a whole number from 1 to 48, or leave it empty.");
  const result = await db.runAsync(
    "UPDATE habits SET follow_up_hours = ? WHERE id = ? AND month_id = ?",
    hours,
    habitId,
    monthId,
  );
  if (result.changes === 0) throw new Error("That row is gone.");
  return hours;
}

export async function setReminder(
  db: SQLiteDatabase,
  monthId: string,
  habitId: string,
  hour: number | null,
  minute: number | null,
): Promise<void> {
  const habit = await requireHabit(db, monthId, habitId);
  if (habit.entry !== "timer") throw new Error("Only a timer row has a reminder.");
  if (hour == null || minute == null) {
    await db.runAsync(
      "UPDATE habits SET reminder_hour = NULL, reminder_minute = NULL WHERE id = ? AND month_id = ?",
      habitId,
      monthId,
    );
    return;
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) throw new Error("Use 6:30 AM or 6:30 PM.");
  await db.runAsync(
    "UPDATE habits SET reminder_hour = ?, reminder_minute = ? WHERE id = ? AND month_id = ?",
    hour,
    minute,
    habitId,
    monthId,
  );
}

export async function renameHabit(
  db: SQLiteDatabase,
  monthId: string,
  habitId: string,
  rawName: string,
): Promise<{ entryChanged: boolean }> {
  const name = validateName(rawName);
  const habit = await requireHabit(db, monthId, habitId);
  await assertUnlocked(db, monthId);
  const entry = entryForName(name, habit.entry);
  const entryChanged = entry !== habit.entry;
  await db.withTransactionAsync(async () => {
    if (entryChanged) {
      await db.runAsync("DELETE FROM day_records WHERE habit_id = ?", habitId);
    }
    await db.runAsync(
      `UPDATE habits
       SET name = ?, entry = ?,
           follow_up_hours = CASE WHEN ? = 'journal' OR ? = 'checklist' THEN NULL ELSE follow_up_hours END,
           reminder_hour = CASE WHEN ? = 'timer' THEN reminder_hour ELSE NULL END,
           reminder_minute = CASE WHEN ? = 'timer' THEN reminder_minute ELSE NULL END
       WHERE id = ? AND month_id = ?`,
      name,
      entry,
      entry,
      entry,
      entry,
      entry,
      habitId,
      monthId,
    );
  });
  return { entryChanged };
}

export async function removeHabit(
  db: SQLiteDatabase,
  monthId: string,
  habitId: string,
): Promise<void> {
  await assertUnlocked(db, monthId);
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM day_records WHERE habit_id = ?", habitId);
    const result = await db.runAsync(
      "DELETE FROM habits WHERE id = ? AND month_id = ?",
      habitId,
      monthId,
    );
    if (result.changes === 0) throw new Error("That row is gone.");
  });
}

export async function moveHabit(
  db: SQLiteDatabase,
  monthId: string,
  habitId: string,
  direction: "up" | "down",
): Promise<void> {
  await assertUnlocked(db, monthId);
  const habits = await db.getAllAsync<{ id: string }>(
    "SELECT id FROM habits WHERE month_id = ? ORDER BY sort_order ASC, id ASC",
    monthId,
  );
  const index = habits.findIndex((habit) => habit.id === habitId);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swapIndex < 0 || swapIndex >= habits.length) return;
  const next = habits.slice();
  const [moved] = next.splice(index, 1);
  if (!moved) return;
  next.splice(swapIndex, 0, moved);
  await db.withTransactionAsync(async () => {
    for (let order = 0; order < next.length; order += 1) {
      const row = next[order];
      if (!row) continue;
      await db.runAsync(
        "UPDATE habits SET sort_order = ? WHERE id = ? AND month_id = ?",
        order,
        row.id,
        monthId,
      );
    }
  });
}

export async function setLocked(
  db: SQLiteDatabase,
  monthId: string,
  locked: boolean,
): Promise<void> {
  const result = await db.runAsync(
    "UPDATE months SET locked = ? WHERE id = ?",
    locked ? 1 : 0,
    monthId,
  );
  if (result.changes === 0) throw new Error("This month is not ready.");
}

async function wrapPastDays(
  db: SQLiteDatabase,
  monthId: string,
  year: number,
  month: number,
  now: Date,
): Promise<void> {
  const today = dateFor(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const started = await db.getFirstAsync<{ started_on: string | null }>(
    "SELECT started_on FROM months WHERE id = ?",
    monthId,
  );
  const startedOn = started?.started_on || today;
  await db.withTransactionAsync(async () => {
    const freshlyWrapped: string[] = [];
    for (let day = 1; day <= daysInMonth(year, month); day += 1) {
      const date = dateFor(year, month, day);
      if (!shouldWrapDate(date, startedOn, today)) continue;
      if (await wrapOneDay(db, monthId, date)) freshlyWrapped.push(date);
    }
    if (freshlyWrapped.length > 0) {
      await carryOpenChecklist(db, monthId, freshlyWrapped, today);
    }
  });
}

async function wrapOneDay(db: SQLiteDatabase, monthId: string, date: string): Promise<boolean> {
  const already = await db.getFirstAsync<{ date: string }>(
    "SELECT date FROM wrapped_days WHERE month_id = ? AND date = ?",
    monthId,
    date,
  );
  if (already) return false;
  const habits = await db.getAllAsync<{ id: string; blank_counts_as_miss: number }>(
    "SELECT id, blank_counts_as_miss FROM habits WHERE month_id = ?",
    monthId,
  );
  for (const habit of habits) {
    if (Number(habit.blank_counts_as_miss) === 0) continue;
    const existing = await db.getFirstAsync<{ habit_id: string }>(
      "SELECT habit_id FROM day_records WHERE habit_id = ? AND date = ?",
      habit.id,
      date,
    );
    if (existing) continue;
    await db.runAsync(
      `INSERT INTO day_records (
         habit_id, date, display, source, clock_hour, clock_minute, span_start, span_end,
         note, photo_path, diary_mark
       ) VALUES (?, ?, 'cross', 'manual', NULL, NULL, NULL, NULL, NULL, NULL, 0)`,
      habit.id,
      date,
    );
  }
  await db.runAsync("INSERT INTO wrapped_days (month_id, date) VALUES (?, ?)", monthId, date);
  return true;
}

async function carryOpenChecklist(
  db: SQLiteDatabase,
  monthId: string,
  sourceDates: readonly string[],
  destination: string,
): Promise<void> {
  if (!sourceDates.length) return;
  const habits = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM habits
     WHERE month_id = ? AND entry = 'checklist' AND carry_forward != 0
     ORDER BY sort_order ASC, id ASC`,
    monthId,
  );
  const placeholders = sourceDates.map(() => "?").join(", ");
  for (const habit of habits) {
    const rows = await db.getAllAsync<{ date: string; checklist: string | null }>(
      `SELECT date, checklist FROM day_records
       WHERE habit_id = ? AND date IN (${placeholders})
       ORDER BY date ASC`,
      habit.id,
      ...sourceDates,
    );
    let incoming: { text: string; done: boolean }[] = [];
    for (const row of rows) {
      incoming = mergeCarriedItems(incoming, parseStoredChecklist(row.checklist));
    }
    if (!incoming.length) continue;
    const existingRow = await db.getFirstAsync<{ checklist: string | null }>(
      "SELECT checklist FROM day_records WHERE habit_id = ? AND date = ?",
      habit.id,
      destination,
    );
    const existing = parseStoredChecklist(existingRow?.checklist ?? null);
    const merged = mergeCarriedItems(existing, incoming);
    if (!merged.length || sameChecklist(existing, merged)) continue;
    const parts = destination.split("-");
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    await saveChecklist(db, monthId, habit.id, year, month, day, merged);
  }
}

async function readMonth(db: SQLiteDatabase, id: string): Promise<MonthState> {
  const monthRow = await db.getFirstAsync<{
    id: string;
    year: number;
    month: number;
    locked: number;
    started_on: string | null;
  }>("SELECT id, year, month, locked, started_on FROM months WHERE id = ?", id);
  if (!monthRow) throw new Error("This month is not ready.");

  const habitRows = await db.getAllAsync<{
    id: string;
    name: string;
    sort_order: number;
    entry: string;
    blank_counts_as_miss: number;
    follow_up_hours: number | null;
    reminder_hour: number | null;
    reminder_minute: number | null;
    tags: string | null;
    carry_forward: number | null;
  }>(
    `SELECT id, name, sort_order, entry, blank_counts_as_miss, follow_up_hours,
            reminder_hour, reminder_minute, tags, carry_forward
     FROM habits WHERE month_id = ? ORDER BY sort_order ASC, id ASC`,
    id,
  );
  const recordRows = await db.getAllAsync<{
    habit_id: string;
    date: string;
    display: string;
    source: string;
    clock_hour: number | null;
    clock_minute: number | null;
    note: string | null;
    photo_path: string | null;
    diary_mark: number | null;
    checklist: string | null;
  }>(
    `SELECT r.habit_id, r.date, r.display, r.source, r.clock_hour, r.clock_minute,
            r.note, r.photo_path, r.diary_mark, r.checklist
     FROM day_records r
     JOIN habits h ON h.id = r.habit_id
     WHERE h.month_id = ?`,
    id,
  );

  const wrappedRows = await db.getAllAsync<{ date: string }>(
    "SELECT date FROM wrapped_days WHERE month_id = ?",
    id,
  );

  return {
    id,
    year: Number(monthRow.year),
    month: Number(monthRow.month),
    locked: Number(monthRow.locked) === 1,
    startedOn: monthRow.started_on || null,
    wrappedDates: wrappedRows.map((row) => row.date),
    habits: habitRows.map((row) => ({
      id: row.id,
      name: row.name,
      sortOrder: Number(row.sort_order),
      entry: asEntry(row.entry),
      blankCountsAsMiss: Number(row.blank_counts_as_miss) !== 0,
      followUpHours: row.follow_up_hours == null ? null : Number(row.follow_up_hours),
      reminderHour: row.reminder_hour == null ? null : Number(row.reminder_hour),
      reminderMinute: row.reminder_minute == null ? null : Number(row.reminder_minute),
      tags: parseStoredTags(row.tags),
      carryForward: row.carry_forward == null || Number(row.carry_forward) !== 0,
    })),
    records: recordRows.flatMap((row) => {
      const source = asSource(row.source);
      if (!source) return [];
      const record: DayRecord = {
        habitId: row.habit_id,
        date: row.date,
        display: row.display,
        source,
        clockHour: row.clock_hour == null ? null : Number(row.clock_hour),
        clockMinute: row.clock_minute == null ? null : Number(row.clock_minute),
        note: row.note,
        photoPath: row.photo_path,
        diaryMark: Number(row.diary_mark) === 1,
        checklist: parseStoredChecklist(row.checklist),
      };
      return [record];
    }),
  };
}

function asEntry(value: string): Entry {
  if (value === "time" || value === "timer") return "timer";
  if (value === "tick" || value === "journal" || value === "checklist") return value;
  throw new Error("That row is not usable.");
}

function asSource(value: string): MarkSource | null {
  if (value === "manual" || value === "alarm") return value;
  return null;
}

async function rememberMonthStart(db: SQLiteDatabase, monthId: string, today: string): Promise<void> {
  const row = await db.getFirstAsync<{ started_on: string | null }>(
    "SELECT started_on FROM months WHERE id = ?",
    monthId,
  );
  if (!row || row.started_on) return;
  await db.withTransactionAsync(async () => {
    const claimed = await db.runAsync(
      "UPDATE months SET started_on = ? WHERE id = ? AND started_on IS NULL",
      today,
      monthId,
    );
    if (claimed.changes === 0) return;
    await db.runAsync(
      `DELETE FROM day_records
       WHERE date < ?
         AND habit_id IN (SELECT id FROM habits WHERE month_id = ?)
         AND display = 'cross'
         AND clock_hour IS NULL
         AND clock_minute IS NULL
         AND note IS NULL
         AND (photo_path IS NULL OR photo_path = '')
         AND diary_mark = 0
         AND (checklist IS NULL OR checklist = '' OR checklist = '[]')`,
      today,
      monthId,
    );
  });
}

async function ensureMonthColumns(db: SQLiteDatabase): Promise<void> {
  const columns = await columnNames(db, "months");
  if (!columns.has("started_on")) {
    await db.execAsync("ALTER TABLE months ADD COLUMN started_on TEXT");
  }
}

async function columnNames(
  db: SQLiteDatabase,
  table: "habits" | "day_records" | "months",
): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return new Set(rows.map((row) => row.name));
}

async function ensureHabitColumns(db: SQLiteDatabase): Promise<void> {
  const columns = await columnNames(db, "habits");
  if (!columns.has("blank_counts_as_miss")) {
    await db.execAsync(
      "ALTER TABLE habits ADD COLUMN blank_counts_as_miss INTEGER NOT NULL DEFAULT 1 CHECK (blank_counts_as_miss IN (0, 1))",
    );
  }
  if (!columns.has("follow_up_hours")) {
    await db.execAsync("ALTER TABLE habits ADD COLUMN follow_up_hours INTEGER");
  }
  if (!columns.has("reminder_hour")) {
    await db.execAsync("ALTER TABLE habits ADD COLUMN reminder_hour INTEGER");
  }
  if (!columns.has("reminder_minute")) {
    await db.execAsync("ALTER TABLE habits ADD COLUMN reminder_minute INTEGER");
  }
  if (!columns.has("tags")) {
    await db.execAsync("ALTER TABLE habits ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
  }
  if (!columns.has("carry_forward")) {
    await db.execAsync(
      "ALTER TABLE habits ADD COLUMN carry_forward INTEGER NOT NULL DEFAULT 1 CHECK (carry_forward IN (0, 1))",
    );
  }
}

async function ensureDayColumns(db: SQLiteDatabase): Promise<void> {
  const columns = await columnNames(db, "day_records");
  if (!columns.has("note")) await db.execAsync("ALTER TABLE day_records ADD COLUMN note TEXT");
  if (!columns.has("photo_path")) {
    await db.execAsync("ALTER TABLE day_records ADD COLUMN photo_path TEXT");
  }
  if (!columns.has("diary_mark")) {
    await db.execAsync(
      "ALTER TABLE day_records ADD COLUMN diary_mark INTEGER NOT NULL DEFAULT 0 CHECK (diary_mark IN (0, 1))",
    );
  }
  if (!columns.has("checklist")) {
    await db.execAsync("ALTER TABLE day_records ADD COLUMN checklist TEXT");
  }
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS wrapped_days (
      month_id TEXT NOT NULL,
      date TEXT NOT NULL,
      PRIMARY KEY (month_id, date)
    );
  `);
}

async function ensureTimerEntry(db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ sql: string | null }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'habits'",
  );
  if (!row?.sql || row.sql.includes("'timer'")) {
    await db.runAsync("UPDATE habits SET entry = 'timer' WHERE entry = 'time'");
    return;
  }
  await db.execAsync("PRAGMA foreign_keys = OFF");
  try {
    await db.execAsync("DROP TABLE IF EXISTS habits_next");
    await db.execAsync(`
      CREATE TABLE habits_next (
        id TEXT PRIMARY KEY,
        month_id TEXT NOT NULL,
        name TEXT NOT NULL CHECK (length(name) > 0 AND length(name) <= 40),
        sort_order INTEGER NOT NULL,
        entry TEXT NOT NULL CHECK (entry IN ('tick', 'timer', 'journal', 'checklist')),
        blank_counts_as_miss INTEGER NOT NULL DEFAULT 1 CHECK (blank_counts_as_miss IN (0, 1)),
        follow_up_hours INTEGER,
        reminder_hour INTEGER,
        reminder_minute INTEGER,
        tags TEXT NOT NULL DEFAULT '[]',
        carry_forward INTEGER NOT NULL DEFAULT 1 CHECK (carry_forward IN (0, 1)),
        FOREIGN KEY (month_id) REFERENCES months (id),
        CHECK (follow_up_hours IS NULL OR (follow_up_hours BETWEEN 1 AND 48)),
        CHECK (
          (reminder_hour IS NULL AND reminder_minute IS NULL)
          OR (reminder_hour BETWEEN 0 AND 23 AND reminder_minute BETWEEN 0 AND 59)
        )
      );
      INSERT INTO habits_next (
        id, month_id, name, sort_order, entry, blank_counts_as_miss,
        follow_up_hours, reminder_hour, reminder_minute, tags, carry_forward
      )
      SELECT id, month_id, name, sort_order,
             CASE entry WHEN 'time' THEN 'timer' ELSE entry END,
             blank_counts_as_miss, follow_up_hours, reminder_hour, reminder_minute,
             COALESCE(tags, '[]'), COALESCE(carry_forward, 1)
      FROM habits;
      DROP TABLE habits;
      ALTER TABLE habits_next RENAME TO habits;
      CREATE INDEX IF NOT EXISTS habits_month_order ON habits (month_id, sort_order);
    `);
  } finally {
    await db.execAsync("PRAGMA foreign_keys = ON");
  }
}

async function ensureChecklistEntry(db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ sql: string | null }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'habits'",
  );
  if (!row?.sql || row.sql.includes("'checklist'")) return;
  await db.execAsync("PRAGMA foreign_keys = OFF");
  try {
    await db.execAsync("DROP TABLE IF EXISTS habits_next");
    await db.execAsync(`
      CREATE TABLE habits_next (
        id TEXT PRIMARY KEY,
        month_id TEXT NOT NULL,
        name TEXT NOT NULL CHECK (length(name) > 0 AND length(name) <= 40),
        sort_order INTEGER NOT NULL,
        entry TEXT NOT NULL CHECK (entry IN ('tick', 'timer', 'journal', 'checklist')),
        blank_counts_as_miss INTEGER NOT NULL DEFAULT 1 CHECK (blank_counts_as_miss IN (0, 1)),
        follow_up_hours INTEGER,
        reminder_hour INTEGER,
        reminder_minute INTEGER,
        tags TEXT NOT NULL DEFAULT '[]',
        carry_forward INTEGER NOT NULL DEFAULT 1 CHECK (carry_forward IN (0, 1)),
        FOREIGN KEY (month_id) REFERENCES months (id),
        CHECK (follow_up_hours IS NULL OR (follow_up_hours BETWEEN 1 AND 48)),
        CHECK (
          (reminder_hour IS NULL AND reminder_minute IS NULL)
          OR (reminder_hour BETWEEN 0 AND 23 AND reminder_minute BETWEEN 0 AND 59)
        )
      );
      INSERT INTO habits_next (
        id, month_id, name, sort_order, entry, blank_counts_as_miss,
        follow_up_hours, reminder_hour, reminder_minute, tags, carry_forward
      )
      SELECT id, month_id, name, sort_order,
             CASE entry WHEN 'time' THEN 'timer' ELSE entry END,
             blank_counts_as_miss, follow_up_hours, reminder_hour, reminder_minute,
             COALESCE(tags, '[]'), COALESCE(carry_forward, 1)
      FROM habits;
      DROP TABLE habits;
      ALTER TABLE habits_next RENAME TO habits;
      CREATE INDEX IF NOT EXISTS habits_month_order ON habits (month_id, sort_order);
    `);
  } finally {
    await db.execAsync("PRAGMA foreign_keys = ON");
  }
}

function dateInMonth(year: number, month: number, day: number): string {
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) {
    throw new Error("That day is not on this grid.");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("That month is not ready.");
  }
  return dateFor(year, month, day);
}

async function requireHabit(db: SQLiteDatabase, monthId: string, habitId: string): Promise<Habit> {
  const row = await db.getFirstAsync<{
    id: string;
    name: string;
    sort_order: number;
    entry: string;
    blank_counts_as_miss: number;
    follow_up_hours: number | null;
    reminder_hour: number | null;
    reminder_minute: number | null;
    tags: string | null;
    carry_forward: number | null;
  }>(
    `SELECT id, name, sort_order, entry, blank_counts_as_miss, follow_up_hours,
            reminder_hour, reminder_minute, tags, carry_forward
     FROM habits WHERE id = ? AND month_id = ?`,
    habitId,
    monthId,
  );
  if (!row) throw new Error("That row is gone.");
  return {
    id: row.id,
    name: row.name,
    sortOrder: Number(row.sort_order),
    entry: asEntry(row.entry),
    blankCountsAsMiss: Number(row.blank_counts_as_miss) !== 0,
    followUpHours: row.follow_up_hours == null ? null : Number(row.follow_up_hours),
    reminderHour: row.reminder_hour == null ? null : Number(row.reminder_hour),
    reminderMinute: row.reminder_minute == null ? null : Number(row.reminder_minute),
    tags: parseStoredTags(row.tags),
    carryForward: row.carry_forward == null || Number(row.carry_forward) !== 0,
  };
}

async function assertUnlocked(db: SQLiteDatabase, monthId: string): Promise<void> {
  const month = await db.getFirstAsync<{ locked: number }>(
    "SELECT locked FROM months WHERE id = ?",
    monthId,
  );
  if (!month) throw new Error("This month is not ready.");
  if (Number(month.locked) === 1) throw new Error("Rows are locked.");
}

async function insertMark(
  db: SQLiteDatabase,
  habitId: string,
  date: string,
  display: string,
  hour: number | null,
  minute: number | null,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO day_records (
       habit_id, date, display, source, clock_hour, clock_minute, span_start, span_end,
       note, photo_path, diary_mark
     ) VALUES (?, ?, ?, 'manual', ?, ?, NULL, NULL, NULL, NULL, 0)
     ON CONFLICT(habit_id, date) DO UPDATE SET
       display = excluded.display,
       source = 'manual',
       clock_hour = excluded.clock_hour,
       clock_minute = excluded.clock_minute,
       span_start = NULL,
       span_end = NULL`,
    habitId,
    date,
    display,
    hour,
    minute,
  );
}

function cleanNote(raw: string, max: number): string | null {
  const note = raw.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (!note) return null;
  if (note.length > max) throw new Error(`Use ${max} characters or fewer.`);
  return note;
}

function createId(): string {
  const uuid = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (uuid) return uuid();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function clockFromTyped(raw: string): { hour: number; minute: number } | null {
  const parsed = parseTimeInput(raw);
  if (!parsed) return null;
  return { hour: parsed.hour, minute: parsed.minute };
}
