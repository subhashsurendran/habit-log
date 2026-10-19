import { Directory, File, Paths } from "expo-file-system";
import {
  deleteDatabaseAsync,
  deserializeDatabaseAsync,
  openDatabaseAsync,
  type SQLiteDatabase,
} from "expo-sqlite";

import { equalBytes } from "./aesGcm";

import { checklistSummary, mergeCarriedItems, normalizeChecklist, parseStoredChecklist, sameChecklist } from "./checklist";
import { OPEN_FAILED } from "./errors";
import { parseFollowUpHours } from "./followUp";
import { currentMonth, dateFor, daysInMonth, monthId, nextDateInSameMonth, shouldWrapDate } from "./month";
import { cleanName, entryForName, NAME_MAX, validateName } from "./names";
import { keepPhotoFile } from "./photoFile";
import { keepVoiceFile } from "./voiceFile";
import { databaseKey, openDatabaseSeal, readSealed, sealDatabase, writeSealed } from "./vault";
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

const OPEN_ATTEMPTS = 5;

let chain: Promise<void> = Promise.resolve();
let dbChain: Promise<unknown> = Promise.resolve();
let opened: Promise<SQLiteDatabase> | null = null;
let handle: SQLiteDatabase | null = null;
let generation = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryWake: (() => void) | null = null;
let pageCloseBound = false;
let sealedKey: Uint8Array | null = null;
let persistReady = false;

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function withDbLock<T>(task: () => Promise<T>): Promise<T> {
  const run = dbChain.then(
    async () => {
      const result = await task();
      await persistSealedCopy(handle).catch(() => undefined);
      return result;
    },
    async () => {
      const result = await task();
      await persistSealedCopy(handle).catch(() => undefined);
      return result;
    },
  );
  dbChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function wakeRetry(): void {
  if (retryTimer != null) clearTimeout(retryTimer);
  retryTimer = null;
  const wake = retryWake;
  retryWake = null;
  wake?.();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    retryWake = resolve;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      retryWake = null;
      resolve();
    }, ms);
  });
}

async function releaseHandle(db: SQLiteDatabase | null): Promise<void> {
  if (!db) return;
  try {
    await db.closeAsync();
  } catch {
    try {
      db.closeSync();
    } catch {
      // Already closed, or the page is going away.
    }
  }
}

function releaseHandleNow(db: SQLiteDatabase | null): void {
  if (!db) return;
  try {
    db.closeSync();
  } catch {
    void db.closeAsync().catch(() => undefined);
  }
}

function bindPageClose(): void {
  if (pageCloseBound) return;
  pageCloseBound = true;
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  window.addEventListener("pagehide", () => {
    releaseOpenNow();
  });
}

function releaseOpenNow(): void {
  generation += 1;
  wakeRetry();
  const current = handle;
  const pending = opened;
  handle = null;
  opened = null;
  releaseHandleNow(current);
  if (!pending) return;
  void pending.then(
    (db) => {
      if (db !== current) void releaseHandle(db);
    },
    () => undefined,
  );
}

async function persistSealedCopy(db: SQLiteDatabase | null): Promise<void> {
  if (!persistReady || !sealedKey || !db) return;
  const plain = new Uint8Array(await db.serializeAsync());
  await writeSealed(sealDatabase(plain, sealedKey));
}

async function openVaultDatabase(): Promise<SQLiteDatabase> {
  sealedKey = await databaseKey();
  const existing = await readSealed();
  if (existing) {
    const plain = openDatabaseSeal(existing, sealedKey);
    try {
      await deleteDatabaseAsync("habit-log.db");
    } catch {
      // The sealed file is the one that opens.
    }
    return deserializeDatabaseAsync(plain);
  }
  const plainDb = await openDatabaseAsync("habit-log.db");
  await prepareDatabase(plainDb);
  const plain = new Uint8Array(await plainDb.serializeAsync());
  await writeSealed(sealDatabase(plain, sealedKey));
  const stored = await readSealed();
  if (!stored || !equalBytes(openDatabaseSeal(stored, sealedKey), plain)) {
    throw new Error(OPEN_FAILED);
  }
  await plainDb.closeAsync();
  try {
    await deleteDatabaseAsync("habit-log.db");
  } catch {
    // Verified sealed copy remains.
  }
  return deserializeDatabaseAsync(plain);
}

async function openPrepared(ticket: number): Promise<SQLiteDatabase> {
  for (let attempt = 0; attempt < OPEN_ATTEMPTS; attempt += 1) {
    if (ticket !== generation) break;
    let db: SQLiteDatabase | null = null;
    try {
      db = await openVaultDatabase();
      if (ticket !== generation) {
        await releaseHandle(db);
        break;
      }
      await prepareDatabase(db);
      persistReady = true;
      await persistSealedCopy(db);
      if (ticket !== generation) {
        await releaseHandle(db);
        break;
      }
      return db;
    } catch {
      await releaseHandle(db);
      if (ticket !== generation || attempt + 1 >= OPEN_ATTEMPTS) break;
      await wait(200 * (attempt + 1));
    }
  }
  throw new Error(OPEN_FAILED);
}

export function openAppDatabase(): Promise<SQLiteDatabase> {
  bindPageClose();
  if (opened) return opened;
  const ticket = generation;
  let published: Promise<SQLiteDatabase>;
  const pending = enqueue(async () => {
    if (ticket !== generation) throw new Error(OPEN_FAILED);
    const db = await openPrepared(ticket);
    if (ticket !== generation) {
      await releaseHandle(db);
      throw new Error(OPEN_FAILED);
    }
    handle = db;
    return db;
  });
  published = pending.catch((error: unknown) => {
    if (opened === published) opened = null;
    if (handle && ticket === generation) handle = null;
    throw error instanceof Error && error.message === OPEN_FAILED ? error : new Error(OPEN_FAILED);
  });
  opened = published;
  return published;
}

/** Closes the open handle after `idle` finishes. A failed open is closed inside the attempt. */
export function closeAppDatabase(idle: Promise<unknown> = Promise.resolve()): Promise<void> {
  generation += 1;
  wakeRetry();
  const pending = opened;
  const current = handle;
  opened = null;
  handle = null;
  return enqueue(async () => {
    await idle.catch(() => undefined);
    const db = pending ? await pending.catch(() => null) : null;
    if (db && db !== current) await releaseHandle(db);
    await releaseHandle(current);
  });
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
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 32),
      value TEXT NOT NULL CHECK (length(value) <= 80)
    );
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
  await dropStoredDataPhotos(db);
}

async function dropStoredDataPhotos(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    UPDATE day_records
    SET photo_path = NULL,
        display = CASE
          WHEN note IS NOT NULL AND length(trim(note)) > 0 THEN 'note'
          WHEN diary_mark = 1 THEN 'diary'
          ELSE display
        END
    WHERE photo_path LIKE 'data:%'
      AND (
        (note IS NOT NULL AND length(trim(note)) > 0)
        OR diary_mark = 1
      );
    DELETE FROM day_records
    WHERE photo_path LIKE 'data:%';
  `);
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
export type HabitTemplate = {
  id: string;
  name: string;
  habits: { name: string; entry: Entry }[];
};
export type TemplateDraft = {
  name: string;
  entry: Entry;
  tags: readonly string[];
};
export const DISPLAY_NAME_KEY = "display_name";
export const SOUND_MUTED_KEY = "sound_muted";
export const EVENING_HOUR_KEY = "evening_hour";
export const EVENING_MINUTE_KEY = "evening_minute";
export const SAMPLE_MONTH_KEY = "sample_month";
const SAMPLE_MONTH_ID = "2026-09";
const SETTING_KEY = /^[a-z0-9_]{1,32}$/;
const TEMPLATE_ROW_MAX = 40;
export type DashboardState = {
  current: MonthState;
  past: StoredMonth[];
  templates: HabitTemplate[];
  sampleMonthId: string | null;
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
    const templateRows = await db.getAllAsync<{
      template_id: string;
      name: string;
      entry: string;
    }>(
      `SELECT template_id, name, entry
       FROM template_rows
       ORDER BY sort_order ASC, id ASC`,
    );
    const habitsByTemplate = new Map<string, { name: string; entry: Entry }[]>();
    for (const row of templateRows) {
      const list = habitsByTemplate.get(row.template_id) ?? [];
      list.push({ name: row.name, entry: asEntry(row.entry) });
      habitsByTemplate.set(row.template_id, list);
    }
    return {
      current,
      past: past.map((row) => ({ id: row.id, year: Number(row.year), month: Number(row.month) })),
      templates: templates.map((template) => ({
        id: template.id,
        name: template.name,
        habits: habitsByTemplate.get(template.id) ?? [],
      })),
      sampleMonthId:
        (
          await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = ?", SAMPLE_MONTH_KEY)
        )?.value ?? null,
    };
  });
}

/** Copies the current habits into September 2026 once. A second launch leaves that month alone. */
export function ensureSampleSeptember(db: SQLiteDatabase, now = new Date()): Promise<void> {
  return withDbLock(() => ensureSampleSeptemberNow(db, now));
}

async function ensureSampleSeptemberNow(db: SQLiteDatabase, now: Date): Promise<void> {
  const existing = await db.getFirstAsync<{ id: string }>("SELECT id FROM months WHERE id = ?", SAMPLE_MONTH_ID);
  if (existing) return;
  const currentId = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (currentId === SAMPLE_MONTH_ID) return;
  const habits = await db.getAllAsync<{
    name: string;
    entry: string;
    blank_counts_as_miss: number;
    tags: string | null;
    carry_forward: number | null;
    pinned: number | null;
  }>(
    `SELECT name, entry, blank_counts_as_miss, tags, carry_forward, pinned
     FROM habits WHERE month_id = ? ORDER BY pinned DESC, sort_order ASC, id ASC`,
    currentId,
  );
  if (!habits.length) return;
  await db.withTransactionAsync(async () => {
    const again = await db.getFirstAsync<{ id: string }>("SELECT id FROM months WHERE id = ?", SAMPLE_MONTH_ID);
    if (again) return;
    await db.runAsync(
      "INSERT INTO months (id, year, month, locked, started_on) VALUES (?, 2026, 9, 1, '2026-09-01')",
      SAMPLE_MONTH_ID,
    );
    const lastDay = daysInMonth(2026, 9);
    for (let index = 0; index < habits.length; index += 1) {
      const habit = habits[index];
      if (!habit) continue;
      const id = `${SAMPLE_MONTH_ID}-sample-${index}`;
      await db.runAsync(
        `INSERT INTO habits (
           id, month_id, name, sort_order, entry, blank_counts_as_miss,
           follow_up_hours, reminder_hour, reminder_minute, tags, carry_forward, pinned
         ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)`,
        id,
        SAMPLE_MONTH_ID,
        habit.name,
        index,
        habit.entry,
        Number(habit.blank_counts_as_miss) === 0 ? 0 : 1,
        habit.tags ?? "[]",
        habit.carry_forward == null || Number(habit.carry_forward) !== 0 ? 1 : 0,
        Number(habit.pinned) === 1 ? 1 : 0,
      );
      for (let day = 1; day <= lastDay && day <= 10; day += 1) {
        await insertSampleMark(db, id, habit.entry, habit.name, dateFor(2026, 9, day), day <= 7 ? "done" : "cross");
      }
    }
    await db.runAsync(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      SAMPLE_MONTH_KEY,
      SAMPLE_MONTH_ID,
    );
  });
}

async function insertSampleMark(
  db: SQLiteDatabase,
  habitId: string,
  entry: string,
  name: string,
  date: string,
  kind: "done" | "cross",
): Promise<void> {
  if (kind === "cross") {
    await db.runAsync(
      `INSERT INTO day_records (
         habit_id, date, display, source, clock_hour, clock_minute, span_start, span_end, note, photo_path, diary_mark
       ) VALUES (?, ?, 'cross', 'manual', NULL, NULL, NULL, NULL, NULL, NULL, 0)`,
      habitId,
      date,
    );
    return;
  }
  if (entry === "timer") {
    const sleep = name.trim().toLowerCase().startsWith("sleep");
    const hour = sleep ? 22 : 6;
    const minute = sleep ? 0 : 30;
    await db.runAsync(
      `INSERT INTO day_records (
         habit_id, date, display, source, clock_hour, clock_minute, span_start, span_end, note, photo_path, diary_mark
       ) VALUES (?, ?, ?, 'manual', ?, ?, NULL, NULL, NULL, NULL, 0)`,
      habitId,
      date,
      formatClock12(hour, minute),
      hour,
      minute,
    );
    return;
  }
  if (entry === "journal") {
    await db.runAsync(
      `INSERT INTO day_records (
         habit_id, date, display, source, clock_hour, clock_minute, span_start, span_end, note, photo_path, diary_mark
       ) VALUES (?, ?, 'note', 'manual', NULL, NULL, NULL, NULL, 'Sample', NULL, 0)`,
      habitId,
      date,
    );
    return;
  }
  if (entry === "checklist") {
    const items = [{ text: "Sample", done: true }];
    await db.runAsync(
      `INSERT INTO day_records (
         habit_id, date, display, source, clock_hour, clock_minute, span_start, span_end,
         note, photo_path, diary_mark, checklist
       ) VALUES (?, ?, ?, 'manual', NULL, NULL, NULL, NULL, NULL, NULL, 0, ?)`,
      habitId,
      date,
      checklistSummary(items),
      JSON.stringify(items),
    );
    return;
  }
  await db.runAsync(
    `INSERT INTO day_records (
       habit_id, date, display, source, clock_hour, clock_minute, span_start, span_end, note, photo_path, diary_mark
     ) VALUES (?, ?, 'tick', 'manual', NULL, NULL, NULL, NULL, ?, NULL, 0)`,
    habitId,
    date,
    date.endsWith("-01") ? "Sample" : null,
  );
}

export function readSetting(db: SQLiteDatabase, key: string): Promise<string | null> {
  if (!SETTING_KEY.test(key)) return Promise.resolve(null);
  return withDbLock(async () => {
    const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = ?", key);
    return row?.value ?? null;
  });
}

export function writeSetting(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  if (!SETTING_KEY.test(key) || value.length > 80) {
    return Promise.reject(new Error("Could not store that on this device."));
  }
  return withDbLock(() =>
    db.runAsync(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      value,
    ),
  ).then(() => undefined);
}

export function clearSetting(db: SQLiteDatabase, key: string): Promise<void> {
  if (!SETTING_KEY.test(key)) return Promise.resolve();
  return withDbLock(() => db.runAsync("DELETE FROM settings WHERE key = ?", key)).then(() => undefined);
}

export function createHabitTemplate(
  db: SQLiteDatabase,
  rawName: string,
  drafts: readonly TemplateDraft[],
): Promise<void> {
  return withDbLock(() => createHabitTemplateNow(db, rawName, drafts));
}

export function startMonthFromTemplate(
  db: SQLiteDatabase,
  templateId: string,
  now = new Date(),
): Promise<void> {
  return withDbLock(() => startMonthFromTemplateNow(db, templateId, now));
}

async function createHabitTemplateNow(
  db: SQLiteDatabase,
  rawName: string,
  drafts: readonly TemplateDraft[],
): Promise<void> {
  const name = templateName(rawName);
  if (!drafts.length) throw new Error("Add a habit before saving.");
  if (drafts.length > TEMPLATE_ROW_MAX) throw new Error("A template holds 40 habits.");
  const rows = drafts.map((draft, index) => {
    const habitName = validateName(draft.name);
    const entry = entryForName(habitName, chosenEntry(draft.entry));
    return { habitName, entry, tags: normalizeTags(draft.tags), index };
  });
  const existing = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM templates WHERE lower(name) = lower(?)",
    name,
  );
  if (existing) throw new Error("That name is already saved.");
  const templateId = createId();
  await db.withTransactionAsync(async () => {
    await db.runAsync("INSERT INTO templates (id, name) VALUES (?, ?)", templateId, name);
    for (const row of rows) {
      await db.runAsync(
        `INSERT INTO template_rows (
           id, template_id, name, sort_order, entry, blank_counts_as_miss,
           reminder_hour, reminder_minute, tags
         ) VALUES (?, ?, ?, ?, ?, 1, NULL, NULL, ?)`,
        createId(),
        templateId,
        row.habitName,
        row.index,
        row.entry,
        JSON.stringify(row.tags),
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

  let outcome: TickOutcome = "empty";
  await withCellUndo(db, habitId, date, async () => {
    const existing = await db.getFirstAsync<{ display: string }>(
      "SELECT display FROM day_records WHERE habit_id = ? AND date = ?",
      habitId,
      date,
    );
    if (!existing) {
      await insertMark(db, habitId, date, "tick", null, null);
      outcome = "tick";
      return;
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
      outcome = "cross";
      return;
    }
    await db.runAsync("DELETE FROM day_records WHERE habit_id = ? AND date = ?", habitId, date);
    outcome = "empty";
  });
  return outcome;
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
  await withCellUndo(db, habitId, date, async () => {
    await db.runAsync("UPDATE day_records SET note = ? WHERE habit_id = ? AND date = ?", note, habitId, date);
  });
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
  await withCellUndo(db, habitId, date, async () => {
    await insertMark(db, habitId, date, formatClock12(hour, minute), hour, minute);
  });
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
  await withCellUndo(db, habitId, date, async () => {
    await db.runAsync("DELETE FROM day_records WHERE habit_id = ? AND date = ?", habitId, date);
  });
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
  voicePath: string | null = null,
): Promise<void> {
  const date = dateInMonth(year, month, day);
  const habit = await requireHabit(db, monthId, habitId);
  if (habit.entry !== "journal") throw new Error("This row is not a journal.");
  const note = cleanNote(rawNote, JOURNAL_NOTE_MAX);
  const photo = keepPhotoFile(photoPath);
  const voice = keepVoiceFile(voicePath);
  if (!note && !photo && !diaryMark && !voice) {
    await withCellUndo(db, habitId, date, async () => {
      await db.runAsync("DELETE FROM day_records WHERE habit_id = ? AND date = ?", habitId, date);
    });
    return;
  }
  const display = note ? "note" : photo ? "photo" : voice ? "voice" : "diary";
  await withCellUndo(db, habitId, date, async () => {
    await db.runAsync(
    `INSERT INTO day_records (
       habit_id, date, display, source, clock_hour, clock_minute, span_start, span_end,
       note, photo_path, diary_mark, voice_path
     ) VALUES (?, ?, ?, 'manual', NULL, NULL, NULL, NULL, ?, ?, ?, ?)
     ON CONFLICT(habit_id, date) DO UPDATE SET
       display = excluded.display,
       source = 'manual',
       clock_hour = NULL,
       clock_minute = NULL,
       span_start = NULL,
       span_end = NULL,
       note = excluded.note,
       photo_path = excluded.photo_path,
       diary_mark = excluded.diary_mark,
       voice_path = excluded.voice_path`,
    habitId,
    date,
    display,
    note,
    photo,
    diaryMark ? 1 : 0,
    voice,
    );
  });
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
  await withCellUndo(db, habitId, date, async () => {
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
  });
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
  const habits = await db.getAllAsync<{ id: string; pinned: number | null }>(
    "SELECT id, pinned FROM habits WHERE month_id = ? ORDER BY pinned DESC, sort_order ASC, id ASC",
    monthId,
  );
  const index = habits.findIndex((habit) => habit.id === habitId);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swapIndex < 0 || swapIndex >= habits.length) return;
  if (Number(habits[index]?.pinned) !== Number(habits[swapIndex]?.pinned)) return;
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
  const started = await db.getFirstAsync<{ started_on: string | null }>(
    "SELECT started_on FROM months WHERE id = ?",
    monthId,
  );
  if (started?.started_on && date < started.started_on) return false;
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
    pinned: number | null;
  }>(
    `SELECT id, name, sort_order, entry, blank_counts_as_miss, follow_up_hours,
            reminder_hour, reminder_minute, tags, carry_forward, pinned
     FROM habits WHERE month_id = ? ORDER BY pinned DESC, sort_order ASC, id ASC`,
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
    voice_path: string | null;
  }>(
    `SELECT r.habit_id, r.date, r.display, r.source, r.clock_hour, r.clock_minute,
            r.note, r.photo_path, r.diary_mark, r.checklist, r.voice_path
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
      pinned: Number(row.pinned) === 1,
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
        photoPath: keepPhotoFile(row.photo_path),
        diaryMark: Number(row.diary_mark) === 1,
        checklist: parseStoredChecklist(row.checklist),
        voicePath: keepVoiceFile(row.voice_path),
      };
      return [record];
    }),
  };
}

function chosenEntry(value: string): Entry {
  if (value === "tick" || value === "timer" || value === "journal" || value === "checklist") return value;
  throw new Error("Choose tick, timer, journal, or checklist.");
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
  if (!columns.has("pinned")) {
    await db.execAsync(
      "ALTER TABLE habits ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1))",
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
  if (!columns.has("voice_path")) {
    await db.execAsync("ALTER TABLE day_records ADD COLUMN voice_path TEXT");
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
    pinned: number | null;
  }>(
    `SELECT id, name, sort_order, entry, blank_counts_as_miss, follow_up_hours,
            reminder_hour, reminder_minute, tags, carry_forward, pinned
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
    pinned: Number(row.pinned) === 1,
  };
}

type CellRow = {
  display: string;
  source: string;
  clock_hour: number | null;
  clock_minute: number | null;
  note: string | null;
  photo_path: string | null;
  diary_mark: number | null;
  checklist: string | null;
  voice_path: string | null;
};

let lastUndo: { habitId: string; date: string; row: CellRow | null } | null = null;

async function readCell(db: SQLiteDatabase, habitId: string, date: string): Promise<CellRow | null> {
  return db.getFirstAsync<CellRow>(
    `SELECT display, source, clock_hour, clock_minute, note, photo_path, diary_mark, checklist, voice_path
     FROM day_records WHERE habit_id = ? AND date = ?`,
    habitId,
    date,
  );
}

async function withCellUndo(
  db: SQLiteDatabase,
  habitId: string,
  date: string,
  task: () => Promise<void>,
): Promise<void> {
  const before = await readCell(db, habitId, date);
  await task();
  lastUndo = { habitId, date, row: before };
}

export function canUndoMark(): boolean {
  return lastUndo != null;
}

export async function undoLastMark(db: SQLiteDatabase): Promise<boolean> {
  const snap = lastUndo;
  if (!snap) return false;
  lastUndo = null;
  if (!snap.row) {
    await db.runAsync("DELETE FROM day_records WHERE habit_id = ? AND date = ?", snap.habitId, snap.date);
    return true;
  }
  const row = snap.row;
  await db.runAsync(
    `INSERT INTO day_records (
       habit_id, date, display, source, clock_hour, clock_minute, span_start, span_end,
       note, photo_path, diary_mark, checklist, voice_path
     ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)
     ON CONFLICT(habit_id, date) DO UPDATE SET
       display = excluded.display,
       source = excluded.source,
       clock_hour = excluded.clock_hour,
       clock_minute = excluded.clock_minute,
       note = excluded.note,
       photo_path = excluded.photo_path,
       diary_mark = excluded.diary_mark,
       checklist = excluded.checklist,
       voice_path = excluded.voice_path`,
    snap.habitId,
    snap.date,
    row.display,
    row.source === "alarm" ? "alarm" : "manual",
    row.clock_hour,
    row.clock_minute,
    row.note,
    row.photo_path,
    Number(row.diary_mark) === 1 ? 1 : 0,
    row.checklist,
    row.voice_path,
  );
  return true;
}

export async function setPinned(
  db: SQLiteDatabase,
  monthId: string,
  habitId: string,
  pinned: boolean,
): Promise<void> {
  await requireHabit(db, monthId, habitId);
  if (pinned) {
    const count = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM habits WHERE month_id = ? AND pinned != 0 AND id != ?",
      monthId,
      habitId,
    );
    if (Number(count?.n ?? 0) >= 3) throw new Error("Three habits can be pinned.");
  }
  await db.runAsync(
    "UPDATE habits SET pinned = ? WHERE id = ? AND month_id = ?",
    pinned ? 1 : 0,
    habitId,
    monthId,
  );
}

export async function reorderHabits(
  db: SQLiteDatabase,
  monthId: string,
  orderedIds: readonly string[],
): Promise<void> {
  await assertUnlocked(db, monthId);
  await db.withTransactionAsync(async () => {
    for (let order = 0; order < orderedIds.length; order += 1) {
      const id = orderedIds[order];
      if (!id) continue;
      await db.runAsync(
        "UPDATE habits SET sort_order = ? WHERE id = ? AND month_id = ?",
        order,
        id,
        monthId,
      );
    }
  });
}

export async function markDoneToday(
  db: SQLiteDatabase,
  monthId: string,
  habitId: string,
  now = new Date(),
): Promise<Entry | null> {
  const habit = await requireHabit(db, monthId, habitId);
  if (now.getFullYear() !== Number(monthId.slice(0, 4)) || now.getMonth() + 1 !== Number(monthId.slice(5))) {
    throw new Error("That day is not on this grid.");
  }
  await assertUnlocked(db, monthId);
  const day = now.getDate();
  if (habit.entry === "tick") {
    const date = dateInMonth(habit ? Number(monthId.slice(0, 4)) : 0, Number(monthId.slice(5)), day);
    const existing = await readCell(db, habitId, date);
    if (existing?.display === "tick") return null;
    await withCellUndo(db, habitId, date, async () => {
      await insertMark(db, habitId, date, "tick", null, null);
    });
    return "tick";
  }
  if (habit.entry === "timer") {
    await setTime(db, monthId, habitId, now.getFullYear(), now.getMonth() + 1, day, now.getHours(), now.getMinutes());
    return "timer";
  }
  if (habit.entry === "journal") {
    const date = dateFor(now.getFullYear(), now.getMonth() + 1, day);
    const existing = await readCell(db, habitId, date);
    await saveJournal(
      db,
      monthId,
      habitId,
      now.getFullYear(),
      now.getMonth() + 1,
      day,
      existing?.note ?? "",
      existing?.photo_path ?? null,
      true,
      existing?.voice_path ?? null,
    );
    return "journal";
  }
  const date = dateFor(now.getFullYear(), now.getMonth() + 1, day);
  const existing = await readCell(db, habitId, date);
  const items = parseStoredChecklist(existing?.checklist ?? null);
  if (!items.length) return null;
  await saveChecklist(
    db,
    monthId,
    habitId,
    now.getFullYear(),
    now.getMonth() + 1,
    day,
    items.map((item) => ({ text: item.text, done: true })),
  );
  return "checklist";
}

export async function saveBackup(db: SQLiteDatabase): Promise<string> {
  if (!Paths.document) throw new Error("Could not store that on this device.");
  const months = await db.getAllAsync("SELECT id, year, month, locked, started_on FROM months ORDER BY id");
  const habits = await db.getAllAsync(
    "SELECT id, month_id, name, sort_order, entry, blank_counts_as_miss, follow_up_hours, reminder_hour, reminder_minute, tags, carry_forward, pinned FROM habits ORDER BY month_id, sort_order",
  );
  const records = await db.getAllAsync(
    "SELECT habit_id, date, display, source, clock_hour, clock_minute, note, photo_path, diary_mark, checklist, voice_path FROM day_records ORDER BY date",
  );
  const templates = await db.getAllAsync("SELECT id, name FROM templates ORDER BY name");
  const templateRows = await db.getAllAsync(
    "SELECT template_id, name, sort_order, entry, blank_counts_as_miss, tags FROM template_rows ORDER BY template_id, sort_order",
  );
  const payload = JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    months,
    habits,
    records,
    templates,
    templateRows,
  });
  const folder = new Directory(Paths.document, "pencheck-backups") as Directory & {
    create: (options?: { intermediates?: boolean; idempotent?: boolean }) => void;
  };
  if (!folder.exists) folder.create({ intermediates: true, idempotent: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = new File(folder, `mydtc-${stamp}.json`) as File & {
    create: (options?: { overwrite?: boolean }) => void;
    write: (content: string) => void;
  };
  file.create({ overwrite: true });
  file.write(payload);
  return file.uri;
}

async function assertUnlocked(db: SQLiteDatabase, monthId: string): Promise<void> {
  const month = await db.getFirstAsync<{ locked: number }>(
    "SELECT locked FROM months WHERE id = ?",
    monthId,
  );
  if (!month) throw new Error("This month is not ready.");
  if (Number(month.locked) === 1) throw new Error("Habits are locked.");
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
