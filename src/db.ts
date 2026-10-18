import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";

import { dateFor } from "./month";
import { entryForName, validateName } from "./names";
import { parseTimeInput } from "./time";
import type { DayRecord, Entry, Habit, MarkSource, MonthState } from "./types";

const DAY_COLUMNS = 31;

const SEED_ROWS: { suffix: string; name: string; entry: Entry }[] = [
  { suffix: "wake-up", name: "Wake up", entry: "time" },
  { suffix: "meditation", name: "Meditation", entry: "tick" },
  { suffix: "reading", name: "Reading", entry: "tick" },
];

let opening: Promise<SQLiteDatabase> | null = null;

export function openAppDatabase(): Promise<SQLiteDatabase> {
  if (!opening) {
    opening = openDatabaseAsync("habit-log.db")
      .then(async (db) => {
        await prepareDatabase(db);
        return db;
      })
      .catch((error: unknown) => {
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
      locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1))
    );
    CREATE TABLE IF NOT EXISTS habits (
      id TEXT PRIMARY KEY,
      month_id TEXT NOT NULL,
      name TEXT NOT NULL CHECK (length(name) > 0 AND length(name) <= 40),
      sort_order INTEGER NOT NULL,
      entry TEXT NOT NULL CHECK (entry IN ('tick', 'time')),
      blank_counts_as_miss INTEGER NOT NULL DEFAULT 1 CHECK (blank_counts_as_miss IN (0, 1)),
      FOREIGN KEY (month_id) REFERENCES months (id)
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
      PRIMARY KEY (habit_id, date),
      FOREIGN KEY (habit_id) REFERENCES habits (id) ON DELETE CASCADE,
      CHECK (
        (clock_hour IS NULL AND clock_minute IS NULL)
        OR (clock_hour BETWEEN 0 AND 23 AND clock_minute BETWEEN 0 AND 59)
      ),
      CHECK (span_start IS NULL AND span_end IS NULL)
    );
    CREATE INDEX IF NOT EXISTS habits_month_order ON habits (month_id, sort_order);
  `);
  await ensureBlankCountsAsMiss(db);
  await ensureAlarmSource(db);
}

export async function loadMonth(db: SQLiteDatabase, now = new Date()): Promise<MonthState> {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const id = `${year}-${String(month).padStart(2, "0")}`;

  await db.withTransactionAsync(async () => {
    const existing = await db.getFirstAsync<{ id: string }>(
      "SELECT id FROM months WHERE id = ?",
      id,
    );
    if (existing) return;
    await db.runAsync(
      "INSERT INTO months (id, year, month, locked) VALUES (?, ?, ?, 0)",
      id,
      year,
      month,
    );
    for (let index = 0; index < SEED_ROWS.length; index += 1) {
      const seed = SEED_ROWS[index];
      await db.runAsync(
        "INSERT INTO habits (id, month_id, name, sort_order, entry, blank_counts_as_miss) VALUES (?, ?, ?, ?, ?, 1)",
        `${id}-${seed.suffix}`,
        id,
        seed.name,
        index,
        seed.entry,
      );
    }
  });

  const monthRow = await db.getFirstAsync<{
    id: string;
    year: number;
    month: number;
    locked: number;
  }>("SELECT id, year, month, locked FROM months WHERE id = ?", id);
  if (!monthRow) throw new Error("This month is not ready.");

  const habitRows = await db.getAllAsync<{
    id: string;
    name: string;
    sort_order: number;
    entry: string;
    blank_counts_as_miss: number;
  }>(
    "SELECT id, name, sort_order, entry, blank_counts_as_miss FROM habits WHERE month_id = ? ORDER BY sort_order ASC, id ASC",
    id,
  );
  const recordRows = await db.getAllAsync<{
    habit_id: string;
    date: string;
    display: string;
    source: string;
    clock_hour: number | null;
    clock_minute: number | null;
  }>(
    `SELECT r.habit_id, r.date, r.display, r.source, r.clock_hour, r.clock_minute
     FROM day_records r
     JOIN habits h ON h.id = r.habit_id
     WHERE h.month_id = ?`,
    id,
  );

  return {
    id,
    year: Number(monthRow.year),
    month: Number(monthRow.month),
    locked: Number(monthRow.locked) === 1,
    habits: habitRows.map((row) => ({
      id: row.id,
      name: row.name,
      sortOrder: Number(row.sort_order),
      entry: asEntry(row.entry),
      blankCountsAsMiss: Number(row.blank_counts_as_miss) !== 0,
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
      };
      return [record];
    }),
  };
}

export async function cycleTick(
  db: SQLiteDatabase,
  monthId: string,
  habitId: string,
  year: number,
  month: number,
  day: number,
): Promise<void> {
  const date = dateInMonth(year, month, day);
  const habit = await requireHabit(db, monthId, habitId);
  if (habit.entry !== "tick") throw new Error("This row takes a time.");

  const existing = await db.getFirstAsync<{ display: string }>(
    "SELECT display FROM day_records WHERE habit_id = ? AND date = ?",
    habitId,
    date,
  );
  if (!existing) {
    await insertMark(db, habitId, date, "tick", null, null);
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
    return;
  }
  await db.runAsync("DELETE FROM day_records WHERE habit_id = ? AND date = ?", habitId, date);
}

export async function setTime(
  db: SQLiteDatabase,
  monthId: string,
  habitId: string,
  year: number,
  month: number,
  day: number,
  raw: string,
): Promise<void> {
  const parsed = parseTimeInput(raw);
  if (!parsed) throw new Error("Use 630 or 18:30.");
  const date = dateInMonth(year, month, day);
  const habit = await requireHabit(db, monthId, habitId);
  if (habit.entry !== "time") throw new Error("This row takes a tick or a cross.");
  await insertMark(db, habitId, date, parsed.display, parsed.hour, parsed.minute);
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

export async function addHabit(
  db: SQLiteDatabase,
  monthId: string,
  rawName: string,
  chosen: Entry,
): Promise<void> {
  const name = validateName(rawName);
  if (chosen !== "tick" && chosen !== "time") throw new Error("Choose tick or time.");
  const entry = entryForName(name, chosen);
  await assertUnlocked(db, monthId);
  const max = await db.getFirstAsync<{ m: number | string | null }>(
    "SELECT MAX(sort_order) AS m FROM habits WHERE month_id = ?",
    monthId,
  );
  const sortOrder = Number(max?.m ?? -1) + 1;
  await db.runAsync(
    "INSERT INTO habits (id, month_id, name, sort_order, entry, blank_counts_as_miss) VALUES (?, ?, ?, ?, ?, 1)",
    createId(),
    monthId,
    name,
    sortOrder,
    entry,
  );
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

export async function renameHabit(
  db: SQLiteDatabase,
  monthId: string,
  habitId: string,
  rawName: string,
): Promise<void> {
  const name = validateName(rawName);
  const habit = await requireHabit(db, monthId, habitId);
  await assertUnlocked(db, monthId);
  const entry = entryForName(name, habit.entry);
  await db.withTransactionAsync(async () => {
    if (entry !== habit.entry) {
      await db.runAsync("DELETE FROM day_records WHERE habit_id = ?", habitId);
    }
    const result = await db.runAsync(
      "UPDATE habits SET name = ?, entry = ? WHERE id = ? AND month_id = ?",
      name,
      entry,
      habitId,
      monthId,
    );
    if (result.changes === 0) throw new Error("That row is gone.");
  });
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
  next.splice(swapIndex, 0, moved);
  await db.withTransactionAsync(async () => {
    for (let order = 0; order < next.length; order += 1) {
      await db.runAsync(
        "UPDATE habits SET sort_order = ? WHERE id = ? AND month_id = ?",
        order,
        next[order].id,
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

function asEntry(value: string): Entry {
  if (value === "tick" || value === "time") return value;
  throw new Error("That row is not usable.");
}

function asSource(value: string): MarkSource | null {
  if (value === "manual" || value === "alarm") return value;
  return null;
}

async function ensureBlankCountsAsMiss(db: SQLiteDatabase): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(habits)");
  if (columns.some((column) => column.name === "blank_counts_as_miss")) return;
  await db.execAsync(
    "ALTER TABLE habits ADD COLUMN blank_counts_as_miss INTEGER NOT NULL DEFAULT 1 CHECK (blank_counts_as_miss IN (0, 1))",
  );
}

async function ensureAlarmSource(db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ sql: string | null }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'day_records'",
  );
  if (!row?.sql || row.sql.includes("'alarm'")) return;
  await db.execAsync(`
    CREATE TABLE day_records_next (
      habit_id TEXT NOT NULL,
      date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      display TEXT NOT NULL CHECK (length(display) > 0 AND length(display) <= 16),
      source TEXT NOT NULL CHECK (source IN ('manual', 'alarm')),
      clock_hour INTEGER,
      clock_minute INTEGER,
      span_start TEXT,
      span_end TEXT,
      PRIMARY KEY (habit_id, date),
      FOREIGN KEY (habit_id) REFERENCES habits (id) ON DELETE CASCADE,
      CHECK (
        (clock_hour IS NULL AND clock_minute IS NULL)
        OR (clock_hour BETWEEN 0 AND 23 AND clock_minute BETWEEN 0 AND 59)
      ),
      CHECK (span_start IS NULL AND span_end IS NULL)
    );
    INSERT INTO day_records_next (
      habit_id, date, display, source, clock_hour, clock_minute, span_start, span_end
    )
    SELECT habit_id, date, display, source, clock_hour, clock_minute, span_start, span_end
    FROM day_records;
    DROP TABLE day_records;
    ALTER TABLE day_records_next RENAME TO day_records;
  `);
}

function dateInMonth(year: number, month: number, day: number): string {
  if (!Number.isInteger(day) || day < 1 || day > DAY_COLUMNS) {
    throw new Error("That day is not on this grid.");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("That month is not ready.");
  }
  return dateFor(year, month, day);
}

async function requireHabit(
  db: SQLiteDatabase,
  monthId: string,
  habitId: string,
): Promise<Habit> {
  const row = await db.getFirstAsync<{
    id: string;
    name: string;
    sort_order: number;
    entry: string;
    blank_counts_as_miss: number;
  }>(
    "SELECT id, name, sort_order, entry, blank_counts_as_miss FROM habits WHERE id = ? AND month_id = ?",
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
       habit_id, date, display, source, clock_hour, clock_minute, span_start, span_end
     ) VALUES (?, ?, ?, 'manual', ?, ?, NULL, NULL)
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

function createId(): string {
  const uuid = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (uuid) return uuid();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
