import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import type { SQLiteDatabase } from "expo-sqlite";

import {
  addHabit,
  clearCell,
  cycleTick,
  loadMonth,
  moveHabit,
  openAppDatabase,
  removeHabit,
  renameHabit,
  saveJournal,
  setBlankCountsAsMiss,
  setFollowUpHours,
  setHabitTags,
  setLocked,
  setReminder,
  setTickNote,
  setTime,
  wrapToday,
} from "./db";
import { errorText } from "./errors";
import { FOLLOW_UP_QUICK, parseFollowUpHours } from "./followUp";
import { dateFor, monthTitle } from "./month";
import { isReservedTimeName, NAME_MAX, testSlug } from "./names";
import { cancelHabitNotifications, syncDailyReminder, syncFollowUp } from "./notify";
import { forgetJournalPhoto, pickJournalPhoto } from "./photo";
import { ADD_PRESETS, cleanTag, normalizeTags, TAG_MAX } from "./tags";
import { countsAsMiss, shownMark } from "./tally";
import { formatClock12, parseTimeInput, to12Hour, to24Hour, type ClockPeriod } from "./time";
import type { DayRecord, Entry, Habit, MonthState } from "./types";

const LABEL_W = 260;
const DAY_W = 68;
const HEADER_H = 40;
const DAY_COUNT = 31;
const DAYS = Array.from({ length: DAY_COUNT }, (_, index) => index + 1);

function rowHeight(entry: Entry): number {
  if (entry === "timer") return 228;
  if (entry === "tick") return 196;
  return 168;
}

export function MonthScreen() {
  const windowWidth = useWindowDimensions().width;
  const dbRef = useRef<SQLiteDatabase | null>(null);
  const queue = useRef(Promise.resolve());
  const [month, setMonth] = useState<MonthState | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [timeEdit, setTimeEdit] = useState<
    { mode: "cell"; habit: Habit; day: number } | { mode: "reminder"; habit: Habit } | null
  >(null);
  const [journalEdit, setJournalEdit] = useState<{ habit: Habit; day: number } | null>(null);
  const [noteEdit, setNoteEdit] = useState<{ habit: Habit; day: number } | null>(null);
  const [renameTarget, setRenameTarget] = useState<Habit | null>(null);

  useEffect(() => {
    let live = true;
    openAppDatabase()
      .then(async (database) => {
        if (!live) return;
        dbRef.current = database;
        setMonth(await loadMonth(database));
      })
      .catch(() => {
        if (!live) return;
        setFatal("Could not open the log on this device.");
      });
    return () => {
      live = false;
    };
  }, []);

  const records = useMemo(() => {
    const map = new Map<string, DayRecord>();
    for (const record of month?.records ?? []) map.set(`${record.habitId}|${record.date}`, record);
    return map;
  }, [month]);

  function enqueue<T>(task: (database: SQLiteDatabase) => Promise<T>): Promise<T> {
    const database = dbRef.current;
    if (!database || !month) return Promise.reject(new Error("The month is not open."));
    const run = queue.current.then(async () => {
      const result = await task(database);
      setMonth(await loadMonth(database));
      setBanner(null);
      return result;
    });
    queue.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run.catch((error: unknown) => {
      setBanner(errorText(error));
      throw error;
    });
  }

  if (fatal) {
    return (
      <SafeAreaView style={styles.screen}>
        <Text style={styles.title}>Pencheck</Text>
        <Text style={styles.hint}>{fatal}</Text>
      </SafeAreaView>
    );
  }
  if (!month) {
    return (
      <SafeAreaView style={styles.screen}>
        <Text style={styles.title}>Pencheck</Text>
        <Text style={styles.hint}>Opening the month…</Text>
      </SafeAreaView>
    );
  }

  const today = new Date();
  const todayDay =
    today.getFullYear() === month.year && today.getMonth() + 1 === month.month
      ? today.getDate()
      : null;
  const gridWidth = Math.max(220, windowWidth - LABEL_W);
  const bodyHeight = HEADER_H + month.habits.reduce((sum, habit) => sum + rowHeight(habit.entry), 0);

  return (
    <SafeAreaView style={styles.screen} testID="month-grid">
      <View style={styles.top}>
        <Text style={styles.title}>Pencheck</Text>
        <Text style={styles.month} testID="month-title">
          {monthTitle(month.year, month.month)}
        </Text>
        <Text style={styles.hint}>
          Days 1–31 scroll sideways. Add a row as Tick, Timer, or Journal. A timer shows a clock
          such as 6:30 AM.
        </Text>
        <View style={styles.actions}>
          {month.locked ? null : (
            <Pressable style={styles.button} onPress={() => setAddOpen(true)} testID="add-row">
              <Text style={styles.buttonText}>Add row</Text>
            </Pressable>
          )}
          <Pressable
            style={styles.button}
            testID="lock-rows"
            onPress={() => {
              void enqueue((database) => setLocked(database, month.id, !month.locked)).catch(
                () => undefined,
              );
            }}
          >
            <Text style={styles.buttonText}>{month.locked ? "Unlock rows" : "Lock rows"}</Text>
          </Pressable>
          <Pressable
            style={styles.button}
            testID="wrap-today"
            onPress={() => {
              void enqueue((database) =>
                wrapToday(database, month.id, month.year, month.month),
              ).catch(() => undefined);
            }}
          >
            <Text style={styles.buttonText}>Wrap up day</Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>
          {month.locked
            ? "Rows are locked. You can still mark days."
            : "Tap a name to rename it. Up and down change the order."}
        </Text>
        {banner ? <Text style={styles.banner}>{banner}</Text> : null}
      </View>

      <ScrollView style={styles.vertical}>
        <View style={[styles.gridRow, { width: windowWidth }]}>
          <View style={{ width: LABEL_W }}>
            <View style={[styles.corner, styles.line]}>
              <Text style={styles.cornerText}>Habit</Text>
            </View>
            {month.habits.map((habit, index) => (
              <NameCell
                key={habit.id}
                habit={habit}
                locked={month.locked}
                isFirst={index === 0}
                isLast={index === month.habits.length - 1}
                onRename={() => setNoteEdit(null)}
                onOpenRename={() => setJournalEdit(null)}
                onRenameHabit={() => {
                  setTimeEdit(null);
                  setRenameTarget(habit);
                }}
                onToggleMiss={(value) => {
                  void enqueue((database) =>
                    setBlankCountsAsMiss(database, month.id, habit.id, value),
                  ).catch(() => undefined);
                }}
                onTags={(tags) => {
                  void enqueue((database) => setHabitTags(database, month.id, habit.id, tags)).catch(
                    () => undefined,
                  );
                }}
                onFollowUp={(raw) => {
                  void enqueue(async (database) => {
                    await setFollowUpHours(database, month.id, habit.id, raw);
                    await cancelHabitNotifications(habit.id);
                  }).catch(() => undefined);
                }}
                onRemind={() => setTimeEdit({ mode: "reminder", habit })}
                onMove={(direction) => {
                  void enqueue((database) =>
                    moveHabit(database, month.id, habit.id, direction),
                  ).catch(() => undefined);
                }}
              />
            ))}
          </View>
          <ScrollView horizontal testID="day-scroll" style={{ width: gridWidth, height: bodyHeight }}>
            <View>
              <View style={styles.dayHeaderRow}>
                {DAYS.map((day) => (
                  <View
                    key={day}
                    testID={`day-number-${day}`}
                    style={[styles.dayHeader, styles.line, todayDay === day && styles.today]}
                  >
                    <Text style={[styles.dayText, todayDay === day && styles.todayText]}>{day}</Text>
                  </View>
                ))}
              </View>
              {month.habits.map((habit) => (
                <View key={habit.id} style={styles.dayHeaderRow}>
                  {DAYS.map((day) => {
                    const record = records.get(
                      `${habit.id}|${dateFor(month.year, month.month, day)}`,
                    );
                    return (
                      <DayCell
                        key={day}
                        habit={habit}
                        day={day}
                        record={record}
                        height={rowHeight(habit.entry)}
                        isToday={todayDay === day}
                        onPress={() => {
                          if (habit.entry === "timer") {
                            setTimeEdit({ mode: "cell", habit, day });
                            return;
                          }
                          if (habit.entry === "journal") {
                            setJournalEdit({ habit, day });
                            return;
                          }
                          void enqueue(async (database) => {
                            const outcome = await cycleTick(
                              database,
                              month.id,
                              habit.id,
                              month.year,
                              month.month,
                              day,
                            );
                            const result = await syncFollowUp({
                              habitId: habit.id,
                              habitName: habit.name,
                              date: dateFor(month.year, month.month, day),
                              hours: habit.followUpHours,
                              completed: outcome === "tick",
                            });
                            if (result === "unavailable") {
                              setBanner("Saved. The notification was not scheduled.");
                            }
                          }).catch(() => undefined);
                        }}
                        onLongPress={() => {
                          if (habit.entry === "tick") setNoteEdit({ habit, day });
                        }}
                      />
                    );
                  })}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </ScrollView>

      {addOpen ? (
        <AddDialog
          onClose={() => setAddOpen(false)}
          onSave={async (name, entry, tags) => {
            await enqueue((database) => addHabit(database, month.id, name, entry, tags));
            setAddOpen(false);
          }}
        />
      ) : null}
      {renameTarget ? (
        <RenameDialog
          habit={renameTarget}
          onClose={() => setRenameTarget(null)}
          onSave={async (name) => {
            const changed = await enqueue((database) =>
              renameHabit(database, month.id, renameTarget.id, name),
            );
            if (changed.entryChanged) await cancelHabitNotifications(renameTarget.id);
            setRenameTarget(null);
          }}
          onRemove={async () => {
            await enqueue((database) => removeHabit(database, month.id, renameTarget.id));
            await cancelHabitNotifications(renameTarget.id);
            setRenameTarget(null);
          }}
        />
      ) : null}
      {timeEdit ? (
        <TimeDialog
          key={timeEdit.mode === "cell" ? `${timeEdit.habit.id}-${timeEdit.day}` : timeEdit.habit.id}
          title={
            timeEdit.mode === "cell"
              ? `${timeEdit.habit.name} · day ${timeEdit.day}`
              : `Remind at · ${timeEdit.habit.name}`
          }
          hour={
            timeEdit.mode === "cell"
              ? records.get(`${timeEdit.habit.id}|${dateFor(month.year, month.month, timeEdit.day)}`)
                  ?.clockHour ?? null
              : timeEdit.habit.reminderHour
          }
          minute={
            timeEdit.mode === "cell"
              ? records.get(`${timeEdit.habit.id}|${dateFor(month.year, month.month, timeEdit.day)}`)
                  ?.clockMinute ?? null
              : timeEdit.habit.reminderMinute
          }
          onClose={() => setTimeEdit(null)}
          onSave={async (hour, minute) => {
            if (timeEdit.mode === "reminder") {
              await enqueue(async (database) => {
                await setReminder(database, month.id, timeEdit.habit.id, hour, minute);
                const result = await syncDailyReminder({
                  habitId: timeEdit.habit.id,
                  habitName: timeEdit.habit.name,
                  hour,
                  minute,
                });
                if (result === "stored") {
                  setBanner("Saved on this device. The browser will not notify you.");
                }
                if (result === "unavailable") {
                  setBanner("Saved. The notification was not scheduled.");
                }
              });
              setTimeEdit(null);
              return;
            }
            await enqueue(async (database) => {
              await setTime(
                database,
                month.id,
                timeEdit.habit.id,
                month.year,
                month.month,
                timeEdit.day,
                hour,
                minute,
              );
              const result = await syncFollowUp({
                habitId: timeEdit.habit.id,
                habitName: timeEdit.habit.name,
                date: dateFor(month.year, month.month, timeEdit.day),
                hours: timeEdit.habit.followUpHours,
                completed: true,
              });
              if (result === "unavailable") setBanner("Saved. The notification was not scheduled.");
            });
            setTimeEdit(null);
          }}
          onClear={
            timeEdit.mode === "cell"
              ? async () => {
                  await enqueue(async (database) => {
                    await clearCell(
                      database,
                      month.id,
                      timeEdit.habit.id,
                      month.year,
                      month.month,
                      timeEdit.day,
                    );
                    await syncFollowUp({
                      habitId: timeEdit.habit.id,
                      habitName: timeEdit.habit.name,
                      date: dateFor(month.year, month.month, timeEdit.day),
                      hours: null,
                      completed: false,
                    });
                  });
                  setTimeEdit(null);
                }
              : async () => {
                  await enqueue(async (database) => {
                    await setReminder(database, month.id, timeEdit.habit.id, null, null);
                    await syncDailyReminder({
                      habitId: timeEdit.habit.id,
                      habitName: timeEdit.habit.name,
                      hour: null,
                      minute: null,
                    });
                  });
                  setTimeEdit(null);
                }
          }
        />
      ) : null}
      {journalEdit ? (
        <JournalDialog
          habit={journalEdit.habit}
          day={journalEdit.day}
          record={records.get(
            `${journalEdit.habit.id}|${dateFor(month.year, month.month, journalEdit.day)}`,
          )}
          onClose={() => setJournalEdit(null)}
          onSave={async (note, photoPath, diary) => {
            await enqueue((database) =>
              saveJournal(
                database,
                month.id,
                journalEdit.habit.id,
                month.year,
                month.month,
                journalEdit.day,
                note,
                photoPath,
                diary,
              ),
            );
            setJournalEdit(null);
          }}
        />
      ) : null}
      {noteEdit ? (
        <NoteDialog
          habit={noteEdit.habit}
          day={noteEdit.day}
          note={
            records.get(`${noteEdit.habit.id}|${dateFor(month.year, month.month, noteEdit.day)}`)
              ?.note ?? ""
          }
          onClose={() => setNoteEdit(null)}
          onSave={async (note) => {
            await enqueue((database) =>
              setTickNote(
                database,
                month.id,
                noteEdit.habit.id,
                month.year,
                month.month,
                noteEdit.day,
                note,
              ),
            );
            setNoteEdit(null);
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

function NameCell({
  habit,
  locked,
  isFirst,
  isLast,
  onRenameHabit,
  onToggleMiss,
  onTags,
  onFollowUp,
  onRemind,
  onMove,
}: {
  habit: Habit;
  locked: boolean;
  isFirst: boolean;
  isLast: boolean;
  onRename: () => void;
  onOpenRename: () => void;
  onRenameHabit: () => void;
  onToggleMiss: (value: boolean) => void;
  onTags: (tags: string[]) => void;
  onFollowUp: (raw: string) => void;
  onRemind: () => void;
  onMove: (direction: "up" | "down") => void;
}) {
  const slug = testSlug(habit.name);
  const height = rowHeight(habit.entry);
  const remind =
    habit.reminderHour != null && habit.reminderMinute != null
      ? formatClock12(habit.reminderHour, habit.reminderMinute)
      : "none";
  return (
    <View style={[styles.nameCell, styles.line, { height }]}>
      <Pressable onPress={onRenameHabit} disabled={locked} testID={`habit-${slug}`}>
        <Text style={styles.habitName} numberOfLines={1}>
          {habit.name}
        </Text>
        <Text style={styles.kind}>{habit.entry}</Text>
      </Pressable>
      <TagLine tags={habit.tags} locked={locked} onTags={onTags} />
      <Pressable
        testID={`miss-flag-${slug}`}
        onPress={() => onToggleMiss(!habit.blankCountsAsMiss)}
      >
        <Text style={styles.missFlag}>
          {habit.blankCountsAsMiss ? "[x]" : "[ ]"} Empty day counts as a miss
        </Text>
      </Pressable>
      {habit.entry === "journal" ? null : (
        <FollowUpLine slug={slug} hours={habit.followUpHours} onFollowUp={onFollowUp} />
      )}
      {habit.entry === "timer" ? (
        <Pressable onPress={onRemind} testID={`remind-${slug}`}>
          <Text style={styles.missFlag}>Remind at {remind}</Text>
        </Pressable>
      ) : null}
      {locked ? null : (
        <View style={styles.reorder}>
          <Pressable disabled={isFirst} onPress={() => onMove("up")}>
            <Text style={[styles.link, isFirst && styles.linkOff]}>Up</Text>
          </Pressable>
          <Pressable disabled={isLast} onPress={() => onMove("down")}>
            <Text style={[styles.link, isLast && styles.linkOff]}>Down</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function TagLine({
  tags,
  locked,
  onTags,
}: {
  tags: string[];
  locked: boolean;
  onTags: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <View>
      <Text style={styles.kind} numberOfLines={1}>
        {tags.length ? tags.join(", ") : "No tags"}
      </Text>
      {locked ? null : (
        <View style={styles.reorder}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Tag"
            maxLength={TAG_MAX}
            style={styles.tagInput}
          />
          <Pressable
            onPress={() => {
              const next = normalizeTags([...tags, draft]);
              if (cleanTag(draft) && !next.includes(cleanTag(draft)) && next.length === tags.length) {
                return;
              }
              onTags(next);
              setDraft("");
            }}
          >
            <Text style={styles.link}>Add</Text>
          </Pressable>
          {tags.map((tag) => (
            <Pressable key={tag} onPress={() => onTags(tags.filter((item) => item !== tag))}>
              <Text style={styles.link}>{tag} x</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function FollowUpLine({
  slug,
  hours,
  onFollowUp,
}: {
  slug: string;
  hours: number | null;
  onFollowUp: (raw: string) => void;
}) {
  const [draft, setDraft] = useState(hours != null && hours !== FOLLOW_UP_QUICK ? String(hours) : "");
  return (
    <View>
      <View style={styles.reorder}>
        <Pressable testID={`follow-8-${slug}`} onPress={() => onFollowUp(String(FOLLOW_UP_QUICK))}>
          <Text style={[styles.link, hours === FOLLOW_UP_QUICK && styles.habitName]}>8 hours</Text>
        </Pressable>
        <TextInput
          testID={`follow-hours-${slug}`}
          value={draft}
          onChangeText={setDraft}
          onBlur={() => onFollowUp(draft)}
          placeholder="hours"
          keyboardType="number-pad"
          style={styles.tagInput}
        />
        <Pressable
          onPress={() => {
            setDraft("");
            onFollowUp("");
          }}
        >
          <Text style={styles.link}>None</Text>
        </Pressable>
      </View>
      {hours != null && Platform.OS === "web" ? (
        <Text style={styles.kind}>Stored. No notification in the browser.</Text>
      ) : null}
    </View>
  );
}

function DayCell({
  habit,
  day,
  record,
  height,
  isToday,
  onPress,
  onLongPress,
}: {
  habit: Habit;
  day: number;
  record: DayRecord | undefined;
  height: number;
  isToday: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const slug = testSlug(habit.name);
  const shown = shownMark(habit.entry, record);
  const glyph =
    shown === "tick"
      ? "✓"
      : shown === "cross"
        ? "✕"
        : shown === "time" && record?.clockHour != null && record.clockMinute != null
          ? formatClock12(record.clockHour, record.clockMinute)
          : shown === "note"
            ? "note"
            : shown === "photo"
              ? "photo"
              : shown === "diary"
                ? "diary"
                : "";
  return (
    <Pressable
      testID={`cell-${slug}-${day}`}
      accessibilityLabel={cellLabel(habit, day, record)}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.cell, styles.line, { height }, isToday && styles.today]}
    >
      <Text
        testID={`mark-${slug}-${day}`}
        style={[
          styles.mark,
          shown === "tick" && styles.tick,
          shown === "cross" && styles.cross,
          shown === "time" && styles.timeMark,
        ]}
      >
        {glyph}
      </Text>
      {habit.entry === "tick" && record?.note ? (
        <Text style={styles.note} numberOfLines={1}>
          {record.note}
        </Text>
      ) : null}
    </Pressable>
  );
}

function AddDialog({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (name: string, entry: Entry, tags: string[]) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<Entry>("tick");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const reserved = isReservedTimeName(name);
  const entry: Entry = reserved ? "timer" : chosen;
  return (
    <Dialog title="Add row" onClose={onClose}>
      <View style={styles.actions}>
        {ADD_PRESETS.map((preset) => (
          <Pressable
            key={preset.name}
            testID={`preset-${preset.name.toLowerCase()}`}
            style={styles.button}
            onPress={() => {
              setName(preset.name);
              setChosen("tick");
              setTags([preset.tag]);
              setMessage(null);
            }}
          >
            <Text style={styles.buttonText}>{preset.name}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        testID="add-name"
        value={name}
        onChangeText={(value) => {
          setName(value);
          setMessage(null);
        }}
        placeholder="Row name"
        maxLength={NAME_MAX}
        autoCorrect={false}
        style={styles.input}
      />
      <View style={styles.actions}>
        {(["tick", "timer", "journal"] as const).map((kind) => (
          <Pressable
            key={kind}
            testID={`add-kind-${kind}`}
            disabled={reserved && kind !== "timer"}
            onPress={() => setChosen(kind)}
            style={[styles.button, entry === kind && styles.buttonOn]}
          >
            <Text style={[styles.buttonText, entry === kind && styles.buttonOnText]}>
              {kind === "tick" ? "Tick" : kind === "timer" ? "Timer" : "Journal"}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.hint}>
        {reserved
          ? "Wake up and Sleep Time are timer rows."
          : "Medicine starts with tablets. Supplement starts with fitness. Remove a tag if you do not want it."}
      </Text>
      <Text style={styles.kind}>{tags.length ? tags.join(", ") : "No tags"}</Text>
      <View style={styles.reorder}>
        <TextInput
          value={tagDraft}
          onChangeText={setTagDraft}
          placeholder="Tag"
          maxLength={TAG_MAX}
          style={styles.tagInput}
        />
        <Pressable
          onPress={() => {
            setTags(normalizeTags([...tags, tagDraft]));
            setTagDraft("");
          }}
        >
          <Text style={styles.link}>Add tag</Text>
        </Pressable>
        {tags.map((tag) => (
          <Pressable key={tag} onPress={() => setTags(tags.filter((item) => item !== tag))}>
            <Text style={styles.link}>{tag} x</Text>
          </Pressable>
        ))}
      </View>
      {message ? <Text style={styles.banner}>{message}</Text> : null}
      <View style={styles.actions}>
        <Pressable
          style={styles.button}
          testID="add-save"
          onPress={() => {
            void onSave(name, entry, tags).catch((error: unknown) => setMessage(errorText(error)));
          }}
        >
          <Text style={styles.buttonText}>Save</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={onClose}>
          <Text style={styles.buttonText}>Cancel</Text>
        </Pressable>
      </View>
    </Dialog>
  );
}

function RenameDialog({
  habit,
  onClose,
  onSave,
  onRemove,
}: {
  habit: Habit;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [name, setName] = useState(habit.name);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <Dialog title="Rename row" onClose={onClose}>
      <TextInput
        testID="rename-input"
        value={name}
        onChangeText={setName}
        maxLength={NAME_MAX}
        autoCorrect={false}
        style={styles.input}
      />
      {message ? <Text style={styles.banner}>{message}</Text> : null}
      <View style={styles.actions}>
        <Pressable
          style={styles.button}
          onPress={() => {
            void onSave(name).catch((error: unknown) => setMessage(errorText(error)));
          }}
        >
          <Text style={styles.buttonText}>Save</Text>
        </Pressable>
        {confirmRemove ? (
          <Pressable
            style={styles.button}
            onPress={() => {
              void onRemove().catch((error: unknown) => setMessage(errorText(error)));
            }}
          >
            <Text style={styles.buttonText}>Confirm remove</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.button} onPress={() => setConfirmRemove(true)}>
            <Text style={styles.buttonText}>Remove</Text>
          </Pressable>
        )}
        <Pressable style={styles.button} onPress={onClose}>
          <Text style={styles.buttonText}>Cancel</Text>
        </Pressable>
      </View>
    </Dialog>
  );
}

function TimeDialog({
  title,
  hour,
  minute,
  onClose,
  onSave,
  onClear,
}: {
  title: string;
  hour: number | null;
  minute: number | null;
  onClose: () => void;
  onSave: (hour: number, minute: number) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const initial = hour == null ? null : to12Hour(hour);
  const [digits, setDigits] = useState(
    initial ? `${initial.hour12}:${String(minute ?? 0).padStart(2, "0")}` : "",
  );
  const [period, setPeriod] = useState<ClockPeriod>(initial?.period ?? "AM");
  const [clock, setClock] = useState<{ hour12: number; minute: number } | null>(
    initial ? { hour12: initial.hour12, minute: minute ?? 0 } : null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const full = clock ? to24Hour(clock.hour12, clock.minute, period) : null;

  function onDigits(text: string) {
    setDigits(text);
    setMessage(null);
    const parsed = parseTimeInput(text);
    if (!parsed) {
      setClock(null);
      return;
    }
    const compact = text.trim();
    const explicit = compact.includes(":") || /^\d{4}$/.test(compact);
    if (explicit) {
      const view = to12Hour(parsed.hour);
      setClock({ hour12: view.hour12, minute: parsed.minute });
      setPeriod(view.period);
      return;
    }
    setClock({ hour12: parsed.hour === 0 ? 12 : parsed.hour, minute: parsed.minute });
    setPeriod("AM");
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <Text style={styles.clock} testID="clock-preview">
        {full ? formatClock12(full.hour, full.minute) : "Type 630"}
      </Text>
      <TextInput
        testID="time-input"
        value={digits}
        onChangeText={onDigits}
        placeholder="630"
        maxLength={5}
        autoCorrect={false}
        style={styles.input}
      />
      <View style={styles.actions}>
        <Pressable
          testID="period-am"
          style={[styles.button, period === "AM" && styles.buttonOn]}
          onPress={() => setPeriod("AM")}
        >
          <Text style={[styles.buttonText, period === "AM" && styles.buttonOnText]}>AM</Text>
        </Pressable>
        <Pressable
          testID="period-pm"
          style={[styles.button, period === "PM" && styles.buttonOn]}
          onPress={() => setPeriod("PM")}
        >
          <Text style={[styles.buttonText, period === "PM" && styles.buttonOnText]}>PM</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>630 is 6:30 AM. Switch AM or PM before you save.</Text>
      {message ? <Text style={styles.banner}>{message}</Text> : null}
      <View style={styles.actions}>
        <Pressable
          style={styles.button}
          testID="time-save"
          onPress={() => {
            if (!full) {
              setMessage("Use 630 for 6:30 AM.");
              return;
            }
            void onSave(full.hour, full.minute).catch((error: unknown) =>
              setMessage(errorText(error)),
            );
          }}
        >
          <Text style={styles.buttonText}>Save</Text>
        </Pressable>
        <Pressable
          style={styles.button}
          testID="time-clear"
          onPress={() => {
            void onClear().catch((error: unknown) => setMessage(errorText(error)));
          }}
        >
          <Text style={styles.buttonText}>Clear</Text>
        </Pressable>
        <Pressable style={styles.button} testID="time-cancel" onPress={onClose}>
          <Text style={styles.buttonText}>Cancel</Text>
        </Pressable>
      </View>
    </Dialog>
  );
}

function JournalDialog({
  habit,
  day,
  record,
  onClose,
  onSave,
}: {
  habit: Habit;
  day: number;
  record: DayRecord | undefined;
  onClose: () => void;
  onSave: (note: string, photoPath: string | null, diary: boolean) => Promise<void>;
}) {
  const [note, setNote] = useState(record?.note ?? "");
  const [photoPath, setPhotoPath] = useState<string | null>(record?.photoPath ?? null);
  const [diary, setDiary] = useState(record?.diaryMark ?? false);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <Dialog title={`${habit.name} · day ${day}`} onClose={onClose}>
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="Note"
        multiline
        style={[styles.input, styles.journalInput]}
      />
      <View style={styles.actions}>
        <Pressable
          style={styles.button}
          onPress={() => {
            void pickJournalPhoto(habit.id, `${day}`)
              .then((path) => {
                if (path) setPhotoPath(path);
              })
              .catch((error: unknown) => setMessage(errorText(error)));
          }}
        >
          <Text style={styles.buttonText}>{photoPath ? "Replace photo" : "Attach photo"}</Text>
        </Pressable>
        {photoPath ? (
          <Pressable
            style={styles.button}
            onPress={() => {
              forgetJournalPhoto(photoPath);
              setPhotoPath(null);
            }}
          >
            <Text style={styles.buttonText}>Remove photo</Text>
          </Pressable>
        ) : null}
        <Pressable style={[styles.button, diary && styles.buttonOn]} onPress={() => setDiary((value) => !value)}>
          <Text style={[styles.buttonText, diary && styles.buttonOnText]}>Wrote it in my diary</Text>
        </Pressable>
      </View>
      {message ? <Text style={styles.banner}>{message}</Text> : null}
      <View style={styles.actions}>
        <Pressable
          style={styles.button}
          onPress={() => {
            void onSave(note, photoPath, diary).catch((error: unknown) => setMessage(errorText(error)));
          }}
        >
          <Text style={styles.buttonText}>Save</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={onClose}>
          <Text style={styles.buttonText}>Cancel</Text>
        </Pressable>
      </View>
    </Dialog>
  );
}

function NoteDialog({
  habit,
  day,
  note,
  onClose,
  onSave,
}: {
  habit: Habit;
  day: number;
  note: string;
  onClose: () => void;
  onSave: (note: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(note);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <Dialog title={`${habit.name} · day ${day}`} onClose={onClose}>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder="Short note"
        maxLength={40}
        style={styles.input}
      />
      {message ? <Text style={styles.banner}>{message}</Text> : null}
      <View style={styles.actions}>
        <Pressable
          style={styles.button}
          onPress={() => {
            void onSave(draft).catch((error: unknown) => setMessage(errorText(error)));
          }}
        >
          <Text style={styles.buttonText}>Save</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={onClose}>
          <Text style={styles.buttonText}>Cancel</Text>
        </Pressable>
      </View>
    </Dialog>
  );
}

function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{title}</Text>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function cellLabel(habit: Habit, day: number, record: DayRecord | undefined): string {
  const shown = shownMark(habit.entry, record);
  if (shown === "blank") {
    return countsAsMiss(habit.entry, habit.blankCountsAsMiss, record)
      ? `${habit.name}, day ${day}, empty, counts as a miss`
      : `${habit.name}, day ${day}, empty`;
  }
  if (shown === "time" && record?.clockHour != null && record.clockMinute != null) {
    return `${habit.name}, day ${day}, ${formatClock12(record.clockHour, record.clockMinute)}`;
  }
  return `${habit.name}, day ${day}, ${shown}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f6f1e7" },
  top: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: "700", color: "#1c2834" },
  month: { marginTop: 2, fontSize: 16, color: "#23415c", fontWeight: "600" },
  hint: { marginTop: 6, color: "#5c6570", fontSize: 13, lineHeight: 18 },
  banner: { marginTop: 8, color: "#8d2f2f", fontSize: 14 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  button: {
    borderWidth: 1,
    borderColor: "#23415c",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#fffdf8",
  },
  buttonText: { color: "#23415c", fontSize: 14, fontWeight: "600" },
  buttonOn: { backgroundColor: "#23415c" },
  buttonOnText: { color: "#fffdf8" },
  vertical: { flex: 1 },
  gridRow: { flexDirection: "row", alignItems: "flex-start" },
  line: { borderColor: "#d3cdc2", borderRightWidth: 1, borderBottomWidth: 1 },
  corner: {
    width: LABEL_W,
    height: HEADER_H,
    justifyContent: "center",
    paddingHorizontal: 10,
    backgroundColor: "#efe8d8",
    borderTopWidth: 1,
    borderLeftWidth: 1,
  },
  cornerText: { color: "#1c2834", fontWeight: "700", fontSize: 13 },
  nameCell: {
    width: LABEL_W,
    justifyContent: "center",
    paddingHorizontal: 8,
    backgroundColor: "#f3ecdf",
    borderLeftWidth: 1,
  },
  habitName: { color: "#1c2834", fontSize: 15, fontWeight: "600" },
  kind: { color: "#5c6570", fontSize: 11, marginTop: 2 },
  missFlag: { color: "#1c2834", fontSize: 11, lineHeight: 14, marginTop: 4 },
  reorder: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4, alignItems: "center" },
  link: { color: "#23415c", fontSize: 12, fontWeight: "600" },
  linkOff: { color: "#b7b1a6" },
  tagInput: {
    borderWidth: 1,
    borderColor: "#d3cdc2",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 64,
    fontSize: 12,
    backgroundColor: "#fff",
  },
  dayHeaderRow: { flexDirection: "row" },
  dayHeader: {
    width: DAY_W,
    height: HEADER_H,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#efe8d8",
    borderTopWidth: 1,
  },
  dayText: { color: "#1c2834", fontSize: 13, fontWeight: "600" },
  cell: {
    width: DAY_W,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fffdf8",
  },
  today: { backgroundColor: "#d9e6f2" },
  todayText: { color: "#18324d", fontWeight: "700" },
  mark: { fontSize: 16, color: "#1c2834", textAlign: "center" },
  tick: { color: "#1f6b3a", fontSize: 22, fontWeight: "700" },
  cross: { color: "#8d2f2f", fontSize: 22, fontWeight: "700" },
  timeMark: { fontSize: 11, fontWeight: "700", color: "#1c2834" },
  note: { fontSize: 9, color: "#5c6570" },
  clock: { fontSize: 28, fontWeight: "700", color: "#1c2834", marginBottom: 8 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(28, 40, 52, 0.35)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: "#fffdf8",
    borderRadius: 12,
    padding: 16,
    maxWidth: 460,
    width: "100%",
    alignSelf: "center",
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: "#1c2834", marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#d3cdc2",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 18,
    color: "#1c2834",
    backgroundColor: "#fff",
  },
  journalInput: { minHeight: 80, textAlignVertical: "top" },
});
