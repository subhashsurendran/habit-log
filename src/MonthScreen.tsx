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
  CHECK_ITEM_MAX,
  CHECKLIST_DAY_NUDGE,
  CHECKLIST_LIMIT,
  CHECKLIST_MAX,
  checklistSummary,
  dayTaskTotal,
  normalizeChecklist,
} from "./checklist";
import {
  addHabit,
  clearCell,
  cycleTick,
  moveHabit,
  openMonth,
  openAppDatabase,
  removeHabit,
  renameHabit,
  saveChecklist,
  saveJournal,
  setBlankCountsAsMiss,
  setCarryForward,
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
import { dateFor, daysInMonth, isWeekend, monthTitle, weekdayLabel } from "./month";
import { isReservedTimeName, NAME_MAX, testSlug } from "./names";
import { cancelHabitNotifications, syncDailyReminder, syncFollowUp } from "./notify";
import { forgetJournalPhoto, pickJournalPhoto } from "./photo";
import { BrandLockup } from "./BrandLockup";
import { scoreMonth } from "./score";
import { ADD_PRESETS, nextTags, TAG_LIMIT_NOTE, TAG_MAX } from "./tags";
import { countsAsMiss, shownMark } from "./tally";
import { formatClock12, parseTimeInput, to12Hour, to24Hour, type ClockPeriod } from "./time";
import type { CheckItem, DayRecord, Entry, Habit, MonthState } from "./types";

const LABEL_W = 168;
const DAY_W = 64;
const HEADER_H = 46;
const ROW_H = 56;

function rowHeight(_entry: Entry): number {
  return ROW_H;
}

export function MonthScreen({ monthId, onHome }: { monthId: string; onHome: () => void }) {
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
  const [checklistEdit, setChecklistEdit] = useState<{ habit: Habit; day: number } | null>(null);
  const [noteEdit, setNoteEdit] = useState<{ habit: Habit; day: number } | null>(null);
  const [renameTarget, setRenameTarget] = useState<Habit | null>(null);
  const [scoreOpen, setScoreOpen] = useState(false);

  useEffect(() => {
    let live = true;
    openAppDatabase()
      .then(async (database) => {
        if (!live) return;
        dbRef.current = database;
        setMonth(await openMonth(database, monthId));
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!live) return;
        setFatal("Could not open the log on this device.");
      });
    return () => {
      live = false;
    };
  }, [monthId]);

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
      setMonth(await openMonth(database, month.id));
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
        <BrandLockup />
        <Text style={styles.hint}>{fatal}</Text>
      </SafeAreaView>
    );
  }
  if (!month) {
    return (
      <SafeAreaView style={styles.screen}>
        <BrandLockup />
        <Text style={styles.hint}>Opening the month…</Text>
      </SafeAreaView>
    );
  }

  const today = new Date();
  const todayDay =
    today.getFullYear() === month.year && today.getMonth() + 1 === month.month
      ? today.getDate()
      : null;
  const days = Array.from({ length: daysInMonth(month.year, month.month) }, (_, index) => index + 1);
  const todayStamp = dateFor(today.getFullYear(), today.getMonth() + 1, today.getDate());
  const score = scoreMonth({
    year: month.year,
    month: month.month,
    today: todayStamp,
    startedOn: month.startedOn,
    wrappedDates: month.wrappedDates,
    habits: month.habits,
    records: month.records,
  });
  const editingHabit = renameTarget
    ? (month.habits.find((habit) => habit.id === renameTarget.id) ?? null)
    : null;
  const gridWidth = Math.max(220, windowWidth - LABEL_W);
  const bodyHeight = HEADER_H + month.habits.reduce((sum, habit) => sum + rowHeight(habit.entry), 0);

  return (
    <SafeAreaView style={styles.screen} testID="month-grid">
      <View style={styles.brandBlock}>
        <BrandLockup />
      </View>
      <View style={styles.controls}>
        <View style={styles.actions}>
          <Pressable style={styles.button} testID="home-button" onPress={onHome}>
            <Text style={styles.buttonText}>Home</Text>
          </Pressable>
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
            style={[styles.button, styles.buttonOn]}
            testID="wrap-today"
            onPress={() => {
              void enqueue(async (database) => {
                await wrapToday(database, month.id, month.year, month.month);
                await setLocked(database, month.id, true);
              }).catch(() => undefined);
            }}
          >
            <Text style={[styles.buttonText, styles.buttonOnText]}>Wrap up day</Text>
          </Pressable>
          <Pressable style={styles.button} testID="month-score" onPress={() => setScoreOpen(true)}>
            <Text style={styles.buttonText}>Month score</Text>
          </Pressable>
        </View>
        <Text style={styles.quiet}>
          {month.locked ? "Rows are locked." : "Wrap up day closes today."}
        </Text>
        {banner ? <Text style={styles.banner}>{banner}</Text> : null}
      </View>
      <View style={styles.monthBar}>
        <Text style={styles.month} testID="month-title">
          {monthTitle(month.year, month.month)}
        </Text>
      </View>

      <ScrollView style={styles.vertical}>
        <View style={[styles.gridRow, { width: windowWidth }]}>
          <View style={{ width: LABEL_W }}>
            <View style={[styles.corner, styles.line]}>
              <Text style={styles.cornerText}>Task</Text>
            </View>
            {month.habits.map((habit) => (
              <NameCell
                key={habit.id}
                habit={habit}
                locked={month.locked}
                onPress={() => {
                  if (month.locked) return;
                  setTimeEdit(null);
                  setRenameTarget(habit);
                }}
              />
            ))}
          </View>
          <ScrollView horizontal testID="day-scroll" style={{ width: gridWidth, height: bodyHeight }}>
            <View>
              <View style={styles.dayHeaderRow}>
                {days.map((day) => {
                  const weekend = isWeekend(month.year, month.month, day);
                  return (
                  <View
                    key={day}
                    testID={`day-number-${day}`}
                    style={[
                      styles.dayHeader,
                      styles.line,
                      weekend && styles.weekend,
                      todayDay === day && styles.today,
                    ]}
                  >
                    <Text
                      style={[
                        styles.weekdayText,
                        weekend && styles.weekendText,
                        todayDay === day && styles.todayText,
                      ]}
                    >
                      {weekdayLabel(month.year, month.month, day)}
                    </Text>
                    <Text
                      style={[
                        styles.dayText,
                        weekend && styles.weekendText,
                        todayDay === day && styles.todayText,
                      ]}
                    >
                      {day}
                    </Text>
                  </View>
                  );
                })}
              </View>
              {month.habits.map((habit) => (
                <View key={habit.id} style={styles.dayHeaderRow}>
                  {days.map((day) => {
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
                        isWeekend={isWeekend(month.year, month.month, day)}
                        isToday={todayDay === day}
                        onPress={() => {
                          if (month.locked) return;
                          if (habit.entry === "timer") {
                            setTimeEdit({ mode: "cell", habit, day });
                            return;
                          }
                          if (habit.entry === "journal") {
                            setJournalEdit({ habit, day });
                            return;
                          }
                          if (habit.entry === "checklist") {
                            setChecklistEdit({ habit, day });
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
                          if (month.locked) return;
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
      {editingHabit ? (
        <RenameDialog
          habit={editingHabit}
          isFirst={month.habits[0]?.id === editingHabit.id}
          isLast={month.habits[month.habits.length - 1]?.id === editingHabit.id}
          onClose={() => setRenameTarget(null)}
          subtasks={
            editingHabit.entry === "checklist" && todayDay != null
              ? (records.get(`${editingHabit.id}|${dateFor(month.year, month.month, todayDay)}`)
                  ?.checklist ?? [])
              : null
          }
          othersOnDay={
            editingHabit.entry === "checklist" && todayDay != null
              ? otherChecklistItems(
                  month.habits,
                  records,
                  dateFor(month.year, month.month, todayDay),
                  editingHabit.id,
                )
              : 0
          }
          onSave={async (name, subtasks) => {
            const changed = await enqueue(async (database) => {
              const result = await renameHabit(database, month.id, editingHabit.id, name);
              if (subtasks && todayDay != null) {
                await saveChecklist(
                  database,
                  month.id,
                  editingHabit.id,
                  month.year,
                  month.month,
                  todayDay,
                  subtasks,
                );
              }
              return result;
            });
            if (changed.entryChanged) await cancelHabitNotifications(editingHabit.id);
            setRenameTarget(null);
          }}
          onRemove={async () => {
            await enqueue((database) => removeHabit(database, month.id, editingHabit.id));
            await cancelHabitNotifications(editingHabit.id);
            setRenameTarget(null);
          }}
          onToggleMiss={(value) => {
            void enqueue((database) =>
              setBlankCountsAsMiss(database, month.id, editingHabit.id, value),
            ).catch(() => undefined);
          }}
          onCarry={(value) => {
            void enqueue((database) =>
              setCarryForward(database, month.id, editingHabit.id, value),
            ).catch(() => undefined);
          }}
          onTags={(tags) => {
            void enqueue((database) => setHabitTags(database, month.id, editingHabit.id, tags)).catch(
              () => undefined,
            );
          }}
          onFollowUp={(raw) => {
            void enqueue(async (database) => {
              await setFollowUpHours(database, month.id, editingHabit.id, raw);
              await cancelHabitNotifications(editingHabit.id);
            }).catch(() => undefined);
          }}
          onRemind={() => {
            const habit = editingHabit;
            setRenameTarget(null);
            setTimeEdit({ mode: "reminder", habit });
          }}
          onMove={(direction) => {
            void enqueue((database) => moveHabit(database, month.id, editingHabit.id, direction)).catch(
              () => undefined,
            );
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
      {checklistEdit ? (
        <ChecklistDialog
          habit={checklistEdit.habit}
          day={checklistEdit.day}
          items={
            records.get(
              `${checklistEdit.habit.id}|${dateFor(month.year, month.month, checklistEdit.day)}`,
            )?.checklist ?? []
          }
          othersOnDay={otherChecklistItems(
            month.habits,
            records,
            dateFor(month.year, month.month, checklistEdit.day),
            checklistEdit.habit.id,
          )}
          onClose={() => setChecklistEdit(null)}
          onSave={async (items) => {
            await enqueue((database) =>
              saveChecklist(
                database,
                month.id,
                checklistEdit.habit.id,
                month.year,
                month.month,
                checklistEdit.day,
                items,
              ),
            );
            setChecklistEdit(null);
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
      {scoreOpen ? (
        <Dialog
          title="Month score"
          onClose={() => setScoreOpen(false)}
          footer={
            <Pressable style={styles.button} testID="score-close" onPress={() => setScoreOpen(false)}>
              <Text style={styles.buttonText}>Close</Text>
            </Pressable>
          }
        >
          <ScoreBody score={score} />
        </Dialog>
      ) : null}
    </SafeAreaView>
  );
}

function ScoreBody({ score }: { score: ReturnType<typeof scoreMonth> }) {
  return (
    <View testID="month-score-screen">
      {score.percent == null ? (
        <Text style={styles.hint} testID="score-empty">
          No closed days yet
        </Text>
      ) : (
        <View>
          <Text style={styles.scorePercent} testID="score-percent">
            {score.percent}%
          </Text>
          <Text style={styles.hint} testID="score-done">
            Done {score.done}
          </Text>
          <Text style={styles.hint} testID="score-miss">
            Miss {score.miss}
          </Text>
        </View>
      )}
      <Text style={styles.fieldLabel}>Focus</Text>
      {score.focus.length ? (
        score.focus.map((item, index) => (
          <Text key={item.label} style={styles.hint} testID={`score-focus-${index}`}>
            {item.label} · {item.misses}
          </Text>
        ))
      ) : (
        <Text style={styles.hint}>None yet</Text>
      )}
    </View>
  );
}

function kindLabel(entry: Entry): string {
  if (entry === "tick") return "Tick";
  if (entry === "timer") return "Timer";
  if (entry === "journal") return "Journal";
  return "Checklist";
}

function rowSubtitle(habit: Habit): string {
  const kind = kindLabel(habit.entry);
  if (!habit.tags.length) return kind;
  return `${kind} · ${habit.tags.join(" · ")}`;
}

function NameCell({
  habit,
  locked,
  onPress,
}: {
  habit: Habit;
  locked: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={locked}
      onPress={onPress}
      testID={`habit-${testSlug(habit.name)}`}
      style={[styles.nameCell, styles.line, { height: ROW_H }]}
    >
      <Text style={styles.habitName} numberOfLines={1}>
        {habit.name}
      </Text>
      <Text style={styles.kind} numberOfLines={1}>
        {rowSubtitle(habit)}
      </Text>
    </Pressable>
  );
}

function DayCell({
  habit,
  day,
  record,
  height,
  isWeekend,
  isToday,
  onPress,
  onLongPress,
}: {
  habit: Habit;
  day: number;
  record: DayRecord | undefined;
  height: number;
  isWeekend: boolean;
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
            : shown === "list"
              ? checklistSummary(record?.checklist ?? [])
              : "";
  return (
    <Pressable
      testID={`cell-${slug}-${day}`}
      accessibilityLabel={cellLabel(habit, day, record)}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.cell, styles.line, { height }, isWeekend && styles.weekend, isToday && styles.today]}
    >
      <Text
        testID={`mark-${slug}-${day}`}
        style={[
          styles.mark,
          shown === "tick" && styles.tick,
          shown === "cross" && styles.cross,
          shown === "time" && styles.timeMark,
          shown === "list" && styles.listMark,
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
    <Dialog
      title="Add row"
      onClose={onClose}
      footer={
        <View style={styles.actions}>
          <Pressable
            style={[styles.button, styles.buttonOn]}
            testID="add-save"
            onPress={() => {
              void onSave(name, entry, tags).catch((error: unknown) => setMessage(errorText(error)));
            }}
          >
            <Text style={[styles.buttonText, styles.buttonOnText]}>Save</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={onClose}>
            <Text style={styles.buttonText}>Cancel</Text>
          </Pressable>
        </View>
      }
    >
      <View style={styles.actions}>
        {ADD_PRESETS.map((preset) => (
          <Pressable
            key={preset.name}
            testID={`preset-${preset.name.toLowerCase()}`}
            style={styles.button}
            onPress={() => {
              setChosen("tick");
              setTags((current) => {
                const withoutPreset = current.filter(
                  (tag) => !ADD_PRESETS.some((item) => item.tag.toLowerCase() === tag.toLowerCase()),
                );
                const next = nextTags(withoutPreset, preset.tag);
                setMessage(next.refused ? TAG_LIMIT_NOTE : null);
                return next.tags;
              });
            }}
          >
            <Text style={styles.buttonText}>
              {preset.name} · {preset.tag}
            </Text>
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
        {(["tick", "timer", "journal", "checklist"] as const).map((kind) => (
          <Pressable
            key={kind}
            testID={`add-kind-${kind}`}
            disabled={reserved && kind !== "timer"}
            onPress={() => setChosen(kind)}
            style={[styles.button, entry === kind && styles.buttonOn]}
          >
            <Text style={[styles.buttonText, entry === kind && styles.buttonOnText]}>
              {kindLabel(kind)}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.hint}>
        {entry === "checklist"
          ? "Subtasks sit under this row."
          : reserved
            ? "Wake up and Sleep Time are timers."
            : "The name stays what you type."}
      </Text>
      <Text style={styles.fieldLabel}>Tags</Text>
      <View style={styles.chips}>
        {tags.map((tag) => (
          <Pressable key={tag} style={styles.chip} onPress={() => setTags(tags.filter((item) => item !== tag))}>
            <Text style={styles.chipText}>{tag}  x</Text>
          </Pressable>
        ))}
        {tags.length ? null : <Text style={styles.kind}>None yet</Text>}
      </View>
      <View style={styles.reorder}>
        <TextInput
          testID="tag-draft"
          value={tagDraft}
          onChangeText={setTagDraft}
          placeholder="Add a tag"
          maxLength={TAG_MAX}
          style={styles.tagInput}
        />
        <Pressable
          style={styles.button}
          testID="add-tag"
          onPress={() => {
            const next = nextTags(tags, tagDraft);
            setTags(next.tags);
            setMessage(next.refused ? TAG_LIMIT_NOTE : null);
            if (!next.refused) setTagDraft("");
          }}
        >
          <Text style={styles.buttonText}>Add</Text>
        </Pressable>
      </View>
      {message ? (
        <Text style={styles.banner} testID="tag-limit-note">
          {message}
        </Text>
      ) : null}
    </Dialog>
  );
}

function RenameDialog({
  habit,
  isFirst,
  isLast,
  onClose,
  onSave,
  subtasks,
  othersOnDay,
  onRemove,
  onToggleMiss,
  onCarry,
  onTags,
  onFollowUp,
  onRemind,
  onMove,
}: {
  habit: Habit;
  isFirst: boolean;
  isLast: boolean;
  onClose: () => void;
  onSave: (name: string, subtasks: CheckItem[] | null) => Promise<void>;
  subtasks: CheckItem[] | null;
  othersOnDay: number;
  onRemove: () => Promise<void>;
  onToggleMiss: (value: boolean) => void;
  onCarry: (value: boolean) => void;
  onTags: (tags: string[]) => void;
  onFollowUp: (raw: string) => void;
  onRemind: () => void;
  onMove: (direction: "up" | "down") => void;
}) {
  const [name, setName] = useState(habit.name);
  const [tagDraft, setTagDraft] = useState("");
  const [hoursDraft, setHoursDraft] = useState(
    habit.followUpHours != null && habit.followUpHours !== FOLLOW_UP_QUICK
      ? String(habit.followUpHours)
      : "",
  );
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lines, setLines] = useState<CheckItem[]>(() =>
    (subtasks ?? []).map((item) => ({ text: item.text, done: item.done })),
  );
  const [rowTags, setRowTags] = useState<string[]>(() => [...habit.tags]);
  const [acceptedOver3, setAcceptedOver3] = useState(false);
  const [acceptedOver12, setAcceptedOver12] = useState(false);
  const [subtaskAsk, setSubtaskAsk] = useState(false);
  const [dayAsk, setDayAsk] = useState(false);
  const slug = testSlug(habit.name);
  const filled = normalizeChecklist(lines).length;

  function addSubtask() {
    if (lines.length >= CHECKLIST_MAX) {
      setMessage("This list holds 24 tasks.");
      return;
    }
    if (filled >= CHECKLIST_LIMIT && !acceptedOver3) {
      setSubtaskAsk(true);
      return;
    }
    setLines((current) => [...current, { text: "", done: false }]);
    setSubtaskAsk(false);
  }

  function saveRow() {
    if (subtasks && dayTaskTotal(othersOnDay, lines) > CHECKLIST_DAY_NUDGE && !acceptedOver12) {
      setDayAsk(true);
      return;
    }
    void onSave(name, subtasks ? lines : null).catch((error: unknown) => setMessage(errorText(error)));
  }
  const remind =
    habit.reminderHour != null && habit.reminderMinute != null
      ? formatClock12(habit.reminderHour, habit.reminderMinute)
      : "None";
  return (
    <Dialog
      title={habit.name}
      onClose={onClose}
      footer={
        <View>
          {message ? (
            <Text
              style={styles.banner}
              testID={message === TAG_LIMIT_NOTE ? "tag-limit-note" : "row-note"}
            >
              {message}
            </Text>
          ) : null}
          {subtasks && dayAsk ? (
            <View style={styles.actions}>
              <Pressable
                style={[styles.button, styles.buttonOn]}
                testID="confirm-over-12-yes"
                onPress={() => {
                  setAcceptedOver12(true);
                  setDayAsk(false);
                  void onSave(name, lines).catch((error: unknown) => setMessage(errorText(error)));
                }}
              >
                <Text style={[styles.buttonText, styles.buttonOnText]}>Yes, keep them</Text>
              </Pressable>
              <Pressable style={styles.button} testID="confirm-over-12-no" onPress={() => setDayAsk(false)}>
                <Text style={styles.buttonText}>Not now</Text>
              </Pressable>
            </View>
          ) : subtasks && subtaskAsk ? (
            <View style={styles.actions}>
              <Pressable
                style={[styles.button, styles.buttonOn]}
                testID="confirm-over-3-yes"
                onPress={() => {
                  setAcceptedOver3(true);
                  setSubtaskAsk(false);
                  setLines((current) =>
                    current.length >= CHECKLIST_MAX ? current : [...current, { text: "", done: false }],
                  );
                }}
              >
                <Text style={[styles.buttonText, styles.buttonOnText]}>Yes, add another</Text>
              </Pressable>
              <Pressable style={styles.button} testID="confirm-over-3-no" onPress={() => setSubtaskAsk(false)}>
                <Text style={styles.buttonText}>Keep 3</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.actions}>
              {subtasks && lines.length < CHECKLIST_MAX ? (
                <Pressable style={[styles.button, styles.buttonOn]} testID="add-checklist-item" onPress={addSubtask}>
                  <Text style={[styles.buttonText, styles.buttonOnText]}>Add a subtask</Text>
                </Pressable>
              ) : null}
              <Pressable style={[styles.button, styles.buttonOn]} testID="row-save" onPress={saveRow}>
                <Text style={[styles.buttonText, styles.buttonOnText]}>Save</Text>
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
              <Pressable style={styles.button} testID="row-cancel" onPress={onClose}>
                <Text style={styles.buttonText}>Cancel</Text>
              </Pressable>
            </View>
          )}
        </View>
      }
    >
      {subtasks ? (
        <View testID="subtask-section">
          <Text style={styles.fieldLabel}>Subtasks</Text>
          <Text style={styles.hint}>These sit under this task, on today.</Text>
          {dayAsk ? (
            <Text style={styles.ask} testID="ask-over-12">
              This day has {dayTaskTotal(othersOnDay, lines)} tasks. Can you finish this many in a day?
            </Text>
          ) : null}
          {subtaskAsk ? (
            <Text style={styles.ask} testID="ask-over-3">
              You already have 3 tasks. Can you complete all of them today?
            </Text>
          ) : null}
          {lines.map((line, index) => (
            <View key={index} style={styles.checkRow}>
              <Pressable
                testID={`check-done-${index}`}
                style={styles.button}
                onPress={() =>
                  setLines((current) =>
                    current.map((item, i) => (i === index ? { ...item, done: !item.done } : item)),
                  )
                }
              >
                <Text style={styles.buttonText}>{line.done ? "[x]" : "[ ]"}</Text>
              </Pressable>
              <TextInput
                testID={`check-text-${index}`}
                value={line.text}
                onChangeText={(text) =>
                  setLines((current) => current.map((item, i) => (i === index ? { ...item, text } : item)))
                }
                placeholder={`Subtask ${index + 1}`}
                placeholderTextColor="#B7A8C9"
                maxLength={CHECK_ITEM_MAX}
                autoCorrect={false}
                style={[styles.input, styles.checkInput]}
              />
            </View>
          ))}
        </View>
      ) : null}
      <Text style={styles.fieldLabel}>Name</Text>
      <TextInput
        testID="rename-input"
        value={name}
        onChangeText={setName}
        maxLength={NAME_MAX}
        autoCorrect={false}
        style={styles.input}
      />
      <Text style={styles.fieldLabel}>Tags</Text>
      <View style={styles.chips}>
        {rowTags.map((tag) => (
          <Pressable
            key={tag}
            style={styles.chip}
            onPress={() => {
              const next = rowTags.filter((item) => item !== tag);
              setRowTags(next);
              onTags(next);
            }}
          >
            <Text style={styles.chipText}>{tag}  x</Text>
          </Pressable>
        ))}
        {rowTags.length ? null : <Text style={styles.kind}>None yet</Text>}
      </View>
      <View style={styles.reorder}>
        <TextInput
          testID="tag-draft"
          value={tagDraft}
          onChangeText={setTagDraft}
          placeholder="Add a tag"
          maxLength={TAG_MAX}
          style={styles.tagInput}
        />
        <Pressable
          style={styles.button}
          testID="tag-add"
          onPress={() => {
            const next = nextTags(rowTags, tagDraft);
            if (next.refused) {
              setMessage(TAG_LIMIT_NOTE);
              return;
            }
            setMessage(null);
            setRowTags(next.tags);
            onTags(next.tags);
            setTagDraft("");
          }}
        >
          <Text style={styles.buttonText}>Add</Text>
        </Pressable>
      </View>
      <Pressable testID={`miss-flag-${slug}`} onPress={() => onToggleMiss(!habit.blankCountsAsMiss)}>
        <Text style={styles.missFlag}>
          {habit.blankCountsAsMiss ? "[x]" : "[ ]"} Empty day counts as a miss
        </Text>
      </Pressable>
      {habit.entry === "checklist" ? (
        <Pressable testID={`carry-flag-${slug}`} onPress={() => onCarry(!habit.carryForward)}>
          <Text style={styles.missFlag}>
            {habit.carryForward ? "[x]" : "[ ]"} Carry unfinished tasks to the next day
          </Text>
        </Pressable>
      ) : null}
      {habit.entry === "journal" || habit.entry === "checklist" ? null : (
        <View>
          <Text style={styles.fieldLabel}>Follow-up after a mark</Text>
          <View style={styles.reorder}>
            <Pressable testID={`follow-8-${slug}`} style={styles.button} onPress={() => onFollowUp(String(FOLLOW_UP_QUICK))}>
              <Text style={styles.buttonText}>8 hours</Text>
            </Pressable>
            <TextInput
              testID={`follow-hours-${slug}`}
              value={hoursDraft}
              onChangeText={setHoursDraft}
              onBlur={() => onFollowUp(hoursDraft)}
              placeholder="Hours"
              keyboardType="number-pad"
              style={styles.tagInput}
            />
            <Pressable
              style={styles.button}
              onPress={() => {
                setHoursDraft("");
                onFollowUp("");
              }}
            >
              <Text style={styles.buttonText}>None</Text>
            </Pressable>
          </View>
          {habit.followUpHours != null && Platform.OS === "web" ? (
            <Text style={styles.kind}>Stored. No notification in the browser.</Text>
          ) : null}
        </View>
      )}
      {habit.entry === "timer" ? (
        <Pressable testID={`remind-${slug}`} onPress={onRemind}>
          <Text style={styles.missFlag}>Remind at {remind}</Text>
        </Pressable>
      ) : null}
      <View style={styles.actions}>
        <Pressable style={styles.button} disabled={isFirst} onPress={() => onMove("up")}>
          <Text style={styles.buttonText}>Move up</Text>
        </Pressable>
        <Pressable style={styles.button} disabled={isLast} onPress={() => onMove("down")}>
          <Text style={styles.buttonText}>Move down</Text>
        </Pressable>
      </View>
      {message ? <Text style={styles.banner}>{message}</Text> : null}
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
      <Text style={styles.quiet}>630 is 6:30 AM.</Text>
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

function otherChecklistItems(
  habits: readonly Habit[],
  records: ReadonlyMap<string, DayRecord>,
  date: string,
  exceptHabitId: string,
): number {
  let total = 0;
  for (const habit of habits) {
    if (habit.entry !== "checklist" || habit.id === exceptHabitId) continue;
    total += records.get(`${habit.id}|${date}`)?.checklist.length ?? 0;
  }
  return total;
}

function ChecklistDialog({
  habit,
  day,
  items,
  othersOnDay,
  onClose,
  onSave,
}: {
  habit: Habit;
  day: number;
  items: CheckItem[];
  othersOnDay: number;
  onClose: () => void;
  onSave: (items: CheckItem[]) => Promise<void>;
}) {
  const [lines, setLines] = useState<CheckItem[]>(() => items.map((item) => ({ text: item.text, done: item.done })));
  const [acceptedOver3, setAcceptedOver3] = useState(false);
  const [acceptedOver12, setAcceptedOver12] = useState(false);
  const [ask, setAsk] = useState<null | "over-3" | "over-12">(null);
  const [message, setMessage] = useState<string | null>(null);
  const filled = normalizeChecklist(lines).length;
  const dayTotal = dayTaskTotal(othersOnDay, lines);

  function setLine(index: number, patch: Partial<CheckItem>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function addLine() {
    if (lines.length >= CHECKLIST_MAX) {
      setMessage("This list holds 24 tasks.");
      return;
    }
    if (filled >= CHECKLIST_LIMIT && !acceptedOver3) {
      setAsk("over-3");
      setMessage(null);
      return;
    }
    setLines((current) => [...current, { text: "", done: false }]);
    setAsk(null);
    setMessage(null);
  }

  function confirmOver3() {
    setAcceptedOver3(true);
    setAsk(null);
    setLines((current) => (current.length >= CHECKLIST_MAX ? current : [...current, { text: "", done: false }]));
  }

  function save() {
    if (dayTotal > CHECKLIST_DAY_NUDGE && !acceptedOver12) {
      setAsk("over-12");
      setMessage(null);
      return;
    }
    void onSave(lines).catch((error: unknown) => setMessage(errorText(error)));
  }

  function confirmOver12() {
    setAcceptedOver12(true);
    setAsk(null);
    void onSave(lines).catch((error: unknown) => setMessage(errorText(error)));
  }

  return (
    <Dialog
      title={`${habit.name} · day ${day}`}
      onClose={onClose}
      footer={
        <View style={styles.actions}>
          {ask === "over-3" ? (
            <>
              <Pressable style={[styles.button, styles.buttonOn]} testID="confirm-over-3-yes" onPress={confirmOver3}>
                <Text style={[styles.buttonText, styles.buttonOnText]}>Yes, add another</Text>
              </Pressable>
              <Pressable style={styles.button} testID="confirm-over-3-no" onPress={() => setAsk(null)}>
                <Text style={styles.buttonText}>Keep 3</Text>
              </Pressable>
            </>
          ) : ask === "over-12" ? (
            <>
              <Pressable style={[styles.button, styles.buttonOn]} testID="confirm-over-12-yes" onPress={confirmOver12}>
                <Text style={[styles.buttonText, styles.buttonOnText]}>Yes, keep them</Text>
              </Pressable>
              <Pressable style={styles.button} testID="confirm-over-12-no" onPress={() => setAsk(null)}>
                <Text style={styles.buttonText}>Not now</Text>
              </Pressable>
            </>
          ) : (
            <>
              {lines.length >= CHECKLIST_MAX ? null : (
                <Pressable style={styles.button} testID="add-checklist-item" onPress={addLine}>
                  <Text style={styles.buttonText}>Add a subtask</Text>
                </Pressable>
              )}
              <Pressable style={[styles.button, styles.buttonOn]} testID="checklist-save" onPress={save}>
                <Text style={[styles.buttonText, styles.buttonOnText]}>Save</Text>
              </Pressable>
              <Pressable style={styles.button} onPress={onClose}>
                <Text style={styles.buttonText}>Cancel</Text>
              </Pressable>
            </>
          )}
        </View>
      }
    >
      <Text style={styles.quiet}>The cell shows how many are done, such as 2/3.</Text>
      {ask === "over-3" ? (
        <Text style={styles.ask} testID="ask-over-3">
          You already have 3 tasks. Can you complete all of them today?
        </Text>
      ) : null}
      {ask === "over-12" ? (
        <Text style={styles.ask} testID="ask-over-12">
          This day has {dayTotal} tasks. Can you finish this many in a day?
        </Text>
      ) : null}
      {lines.map((line, index) => (
        <View key={index} style={styles.checkRow}>
          <Pressable
            testID={`check-done-${index}`}
            style={styles.button}
            onPress={() => setLine(index, { done: !line.done })}
          >
            <Text style={styles.buttonText}>{line.done ? "[x]" : "[ ]"}</Text>
          </Pressable>
          <TextInput
            testID={`check-text-${index}`}
            value={line.text}
            onChangeText={(text) => setLine(index, { text })}
            placeholder={`Subtask ${index + 1}`}
            placeholderTextColor="#B7A8C9"
            maxLength={CHECK_ITEM_MAX}
            autoCorrect={false}
            style={[styles.input, styles.checkInput]}
          />
        </View>
      ))}
      {lines.length >= CHECKLIST_MAX ? <Text style={styles.hint}>This list holds 24 tasks.</Text> : null}
      {message ? <Text style={styles.banner}>{message}</Text> : null}
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
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{title}</Text>
          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? <View style={styles.modalFooter}>{footer}</View> : null}
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
  if (shown === "list") {
    return `${habit.name}, day ${day}, ${checklistSummary(record?.checklist ?? [])}`;
  }
  return `${habit.name}, day ${day}, ${shown}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#16121C" },
  brandBlock: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 8 },
  controls: { paddingHorizontal: 16, marginTop: 24 },
  monthBar: { paddingHorizontal: 16, marginTop: 24, marginBottom: 12 },
  scorePercent: { fontSize: 40, fontWeight: "800", color: "#F6F1FF" },
  month: { fontSize: 17, color: "#F6F1FF", fontWeight: "600" },
  hint: { marginTop: 8, color: "#D9CCEA", fontSize: 13, lineHeight: 18 },
  quiet: { marginTop: 8, color: "#8E819C", fontSize: 13, lineHeight: 18 },
  ask: { marginTop: 12, color: "#F6F1FF", fontSize: 16, lineHeight: 22, fontWeight: "700" },
  banner: { marginTop: 8, color: "#FF8AA0", fontSize: 14 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 0 },
  button: {
    height: 36,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#3A3348",
    borderRadius: 10,
    paddingHorizontal: 14,
    backgroundColor: "#1C1726",
  },
  buttonText: { color: "#E7DCF8", fontSize: 14, fontWeight: "600" },
  buttonOn: { backgroundColor: "#2A2340", borderColor: "#6E5A8A" },
  buttonOnText: { color: "#F6F1FF" },
  vertical: { flex: 1 },
  gridRow: { flexDirection: "row", alignItems: "flex-start" },
  line: { borderColor: "#2C2636", borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  corner: {
    width: LABEL_W,
    height: HEADER_H,
    justifyContent: "center",
    paddingHorizontal: 16,
    backgroundColor: "#1C1726",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  cornerText: { color: "#6E5A8A", fontWeight: "500", fontSize: 11, letterSpacing: 0.4 },
  nameCell: {
    width: LABEL_W,
    justifyContent: "center",
    paddingHorizontal: 16,
    backgroundColor: "#1C1726",
    borderLeftWidth: 1,
  },
  habitName: { color: "#FFFFFF", fontSize: 17, fontWeight: "700" },
  kind: { color: "#8E819C", fontSize: 11, marginTop: 2 },
  fieldLabel: {
    marginTop: 14,
    marginBottom: 6,
    color: "#D9CCEA",
    fontSize: 12,
    fontWeight: "600",
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: "#3A3348",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: "#1C1726",
  },
  chipText: { color: "#F6F1FF", fontSize: 13 },
  missFlag: { color: "#F6F1FF", fontSize: 11, lineHeight: 14, marginTop: 4 },
  reorder: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4, alignItems: "center" },
  link: { color: "#F4ECFF", fontSize: 12, fontWeight: "700" },
  linkOff: { color: "#8A7A9E" },
  tagInput: {
    borderWidth: 1,
    borderColor: "#3A3348",
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 64,
    fontSize: 12,
    color: "#F6F1FF",
    backgroundColor: "#16121C",
  },
  dayHeaderRow: { flexDirection: "row" },
  dayHeader: {
    width: DAY_W,
    height: HEADER_H,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1C1726",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  weekdayText: { color: "#6E5A8A", fontSize: 9, fontWeight: "500", lineHeight: 12 },
  dayText: {
    color: "#A894C4",
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 16,
    textShadowColor: "rgba(255, 255, 255, 0.38)",
    textShadowOffset: { width: 0, height: -1 },
    textShadowRadius: 0,
  },
  cell: {
    width: DAY_W,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1C1726",
  },
  weekend: { backgroundColor: "#201A2A" },
  weekendText: { color: "#B9A8D4" },
  today: { backgroundColor: "#262033" },
  todayText: {
    color: "#D4C6F5",
    fontWeight: "500",
    textShadowColor: "rgba(255, 255, 255, 0.38)",
    textShadowOffset: { width: 0, height: -1 },
    textShadowRadius: 0,
  },
  mark: { fontSize: 16, color: "#F6F1FF", textAlign: "center" },
  tick: { color: "#3DDC97", fontSize: 22, fontWeight: "800" },
  cross: { color: "#FF8AA0", fontSize: 22, fontWeight: "800" },
  timeMark: { fontSize: 11, fontWeight: "800", color: "#F6F1FF" },
  listMark: { fontSize: 13, fontWeight: "800", color: "#F6F1FF" },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  checkInput: { flex: 1, fontSize: 16, minWidth: 140 },
  note: { fontSize: 9, color: "#D9CCEA" },
  clock: { fontSize: 28, fontWeight: "800", color: "#F6F1FF", marginBottom: 8 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(8, 6, 12, 0.72)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: "#1C1726",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#6E5A8A",
    borderRadius: 10,
    padding: 16,
    maxWidth: 460,
    width: "100%",
    maxHeight: "88%",
    alignSelf: "center",
  },
  modalBody: { flexShrink: 1 },
  modalFooter: { paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#3A3348" },
  modalTitle: { fontSize: 18, fontWeight: "800", color: "#F6F1FF", marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#3A3348",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 18,
    color: "#F6F1FF",
    backgroundColor: "#16121C",
  },
  journalInput: { minHeight: 80, textAlignVertical: "top" },
});
