import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from "react";
import {
  Animated,
  Modal,
  PanResponder,
  Platform,
  Pressable,
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
  canUndoMark,
  clearSetting,
  cycleTick,
  EVENING_HOUR_KEY,
  EVENING_MINUTE_KEY,
  SAMPLE_MONTH_KEY,
  moveHabit,
  openMonth,
  readSetting,
  reorderHabits,
  saveBackup,
  restoreBackup,
  listBackupNames,
  listAllowsMore,
  allowMoreOnList,
  dayAllowsMore,
  allowMoreOnDay,
  setPinned,
  undoLastMark,
  writeSetting,
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
import { errorText, logOpenFailed, OPEN_FAILED } from "./errors";
import { FOLLOW_UP_QUICK, parseFollowUpHours } from "./followUp";
import { dateFor, daysInMonth, isWeekend, monthTitle, weekdayLabel } from "./month";
import { isReservedTimeName, NAME_MAX, testSlug } from "./names";
import { cancelHabitNotifications, reminderIsScheduled, syncDailyReminder, syncEveningWrap, syncFollowUp } from "./notify";
import { forgetJournalPhoto, pickJournalPhoto } from "./photo";
import { keepPhotoFile, PHOTO_REFUSED } from "./photoFile";
import { keepVoiceFile, storeVoiceNote, VOICE_REFUSED } from "./voiceFile";
import { ADD_PRESETS, nextTags, TAG_LIMIT_NOTE, TAG_MAX } from "./tags";
import { countsAsMiss, shownMark } from "./tally";
import { scoreStoredMonth } from "./score";
import { formatClock12, parseTimeInput, to12Hour, to24Hour, type ClockPeriod } from "./time";
import type { CheckItem, DayRecord, Entry, Habit, MonthState } from "./types";

const LABEL_W = 168;
const LABEL_MIN = 120;
const DAY_PHONE = 48;
const DAY_DESK = 64;
const HEADER_H = 46;
const ROW_H = 56;

function gridMetrics(windowWidth: number): { labelWidth: number; track: number; dayWidth: number } {
  const narrow = windowWidth < 520;
  const labelWidth = narrow
    ? Math.min(LABEL_W, Math.max(LABEL_MIN, Math.round(windowWidth * 0.38)))
    : LABEL_W;
  const track = Math.max(1, windowWidth - labelWidth);
  const columns = Math.max(1, Math.floor(track / (narrow ? DAY_PHONE : DAY_DESK)));
  return { labelWidth, track, dayWidth: Math.floor(track / columns) };
}

function todayScrollX(todayDay: number, dayWidth: number, track: number, dayCount: number): number {
  const max = Math.max(0, dayCount * dayWidth - track);
  const centered = (todayDay - 1) * dayWidth - (track - dayWidth) / 2;
  return Math.max(0, Math.min(max, Math.round(centered)));
}

function rowHeight(_entry: Entry): number {
  return ROW_H;
}

export function MonthScreen({
  monthId,
  openAdd = false,
  review = false,
  bindBack,
  onOpenScore,
}: {
  monthId: string;
  openAdd?: boolean;
  review?: boolean;
  bindBack?: (handler: (() => boolean) | null) => void;
  onOpenScore?: () => void;
}) {
  const windowWidth = useWindowDimensions().width;
  const dbRef = useRef<SQLiteDatabase | null>(null);
  const queue = useRef(Promise.resolve());
  const dayScrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const revealedKey = useRef("");
  const [month, setMonth] = useState<MonthState | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(openAdd);
  const [timeEdit, setTimeEdit] = useState<
    { mode: "cell"; habit: Habit; day: number } | { mode: "reminder"; habit: Habit } | null
  >(null);
  const [journalEdit, setJournalEdit] = useState<{ habit: Habit; day: number } | null>(null);
  const [checklistEdit, setChecklistEdit] = useState<{ habit: Habit; day: number } | null>(null);
  const [noteEdit, setNoteEdit] = useState<{ habit: Habit; day: number } | null>(null);
  const [renameTarget, setRenameTarget] = useState<Habit | null>(null);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [editingPast, setEditingPast] = useState(false);
  const [evening, setEvening] = useState<{ hour: number; minute: number } | null>(null);
  const [eveningOpen, setEveningOpen] = useState(false);
  const [undoReady, setUndoReady] = useState(false);
  const [sample, setSample] = useState(false);
  const [more, setMore] = useState(false);
  const [restoreArmed, setRestoreArmed] = useState(false);
  const checklistRef = useRef(checklistEdit);
  checklistRef.current = checklistEdit;

  useEffect(() => {
    let live = true;
    openAppDatabase()
      .then(async (database) => {
        if (!live) return;
        dbRef.current = database;
        setMonth(await openMonth(database, monthId));
        const flagged = await readSetting(database, SAMPLE_MONTH_KEY);
        if (live) setSample(flagged === monthId);
        const hour = await readSetting(database, EVENING_HOUR_KEY);
        const minute = await readSetting(database, EVENING_MINUTE_KEY);
        if (hour != null && minute != null) {
          setEvening({ hour: Number(hour), minute: Number(minute) });
        }
      })
      .catch(() => {
        if (!live) return;
        logOpenFailed();
        setFatal(OPEN_FAILED);
      });
    return () => {
      live = false;
      dbRef.current = null;
    };
  }, [monthId]);

  useEffect(() => {
    if (!bindBack) return;
    bindBack(() => {
      if (!checklistRef.current) return false;
      setChecklistEdit(null);
      return true;
    });
    return () => bindBack(null);
  }, [bindBack]);

  const records = useMemo(() => {
    const map = new Map<string, DayRecord>();
    for (const record of month?.records ?? []) map.set(`${record.habitId}|${record.date}`, record);
    return map;
  }, [month]);

  function enqueue<T>(task: (database: SQLiteDatabase) => Promise<T>): Promise<T> {
    const database = dbRef.current;
    if (!database || !month) return Promise.reject(new Error("The month is not open."));
    const run = queue.current.then(async () => {
      setBanner(null);
      const result = await task(database);
      setMonth(await openMonth(database, month.id));
      setUndoReady(canUndoMark());
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
      <View style={styles.screen}>
        <Text style={styles.hint}>{fatal}</Text>
      </View>
    );
  }
  if (!month) {
    return (
      <View style={styles.screen}>
        <Text style={styles.hint}>Opening the month…</Text>
      </View>
    );
  }

  const today = new Date();
  const todayDay =
    today.getFullYear() === month.year && today.getMonth() + 1 === month.month
      ? today.getDate()
      : null;
  const days = Array.from({ length: daysInMonth(month.year, month.month) }, (_, index) => index + 1);
  const editingHabit = renameTarget
    ? (month.habits.find((habit) => habit.id === renameTarget.id) ?? null)
    : null;
  const gridMonth = month;
  const readOnly = review && !editingPast;
  const frozen = readOnly || month.locked;
  const needle = query.trim().toLowerCase();
  const visibleHabits = month.habits.filter((habit) => {
    if (needle && !habit.name.toLowerCase().includes(needle)) return false;
    if (tagFilter && !habit.tags.some((tag) => tag.toLowerCase() === tagFilter.toLowerCase())) return false;
    return true;
  });
  const pastScore = review ? scoreStoredMonth(month) : null;
  const tagChoices = [...new Set(month.habits.flatMap((habit) => habit.tags))];
  const { labelWidth, track, dayWidth } = gridMetrics(windowWidth);
  const bodyHeight = HEADER_H + visibleHabits.reduce((sum, habit) => sum + rowHeight(habit.entry), 0);

  function dropHabit(habit: Habit, slots: number) {
    if (!slots || needle || tagFilter || frozen) return;
    const pinned = gridMonth.habits.filter((item) => item.pinned).map((item) => item.id);
    const rest = gridMonth.habits.filter((item) => !item.pinned).map((item) => item.id);
    const group = habit.pinned ? pinned : rest;
    const index = group.indexOf(habit.id);
    const next = index + slots;
    if (index < 0 || next < 0 || next >= group.length) return;
    const moved = [...group];
    const [id] = moved.splice(index, 1);
    if (!id) return;
    moved.splice(next, 0, id);
    const ordered = habit.pinned ? [...moved, ...rest] : [...pinned, ...moved];
    void enqueue((database) => reorderHabits(database, gridMonth.id, ordered)).catch(() => undefined);
  }

  function revealToday() {
    if (todayDay == null) return;
    const key = `${gridMonth.id}:${todayDay}:${dayWidth}:${track}`;
    if (revealedKey.current === key) return;
    const scroller = dayScrollRef.current;
    if (!scroller) return;
    revealedKey.current = key;
    scroller.scrollTo({
      x: todayScrollX(todayDay, dayWidth, track, days.length),
      animated: false,
    });
  }

  if (checklistEdit) {
    return (
      <View style={styles.screen} testID="month-grid">
        <ChecklistDialog
          habit={checklistEdit.habit}
          day={checklistEdit.day}
          date={dateFor(month.year, month.month, checklistEdit.day)}
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
      </View>
    );
  }

  return (
    <View style={styles.screen} testID="month-grid">
      <View style={styles.controls}>
        <View style={styles.actions}>
          {review && readOnly ? (
            <Pressable
              style={styles.button}
              accessibilityLabel="Edit"
              testID="edit-month"
              onPress={() => {
                setEditingPast(true);
                if (month.locked) {
                  void enqueue((database) => setLocked(database, month.id, false)).catch(() => undefined);
                }
              }}
            >
              <Text style={styles.buttonText}>Edit</Text>
            </Pressable>
          ) : (
            <>
              {frozen ? null : (
                <Pressable
                  style={styles.button}
                  accessibilityLabel="Add habit"
                  onPress={() => setAddOpen(true)}
                  testID="add-row"
                >
                  <Text style={styles.buttonText}>Add habit</Text>
                </Pressable>
              )}
              {review ? (
                <Pressable
                  style={styles.button}
                  accessibilityLabel="Done"
                  testID="done-edit"
                  onPress={() => {
                    setEditingPast(false);
                    void enqueue((database) => setLocked(database, month.id, true)).catch(() => undefined);
                  }}
                >
                  <Text style={styles.buttonText}>Done</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={styles.button}
                  accessibilityLabel={month.locked ? "Unlock habits" : "Lock habits"}
                  testID="lock-rows"
                  onPress={() => {
                    void enqueue((database) => setLocked(database, month.id, !month.locked)).catch(
                      () => undefined,
                    );
                  }}
                >
                  <Text style={styles.buttonText}>{month.locked ? "Unlock habits" : "Lock habits"}</Text>
                </Pressable>
              )}
              {review ? null : (
                <Pressable
                  style={[styles.button, styles.buttonOn]}
                  accessibilityLabel="Wrap up day"
                  testID="wrap-today"
                  onPress={() => {
                    void enqueue(async (database) => {
                      await wrapToday(database, month.id, month.year, month.month);
                      await setLocked(database, month.id, true);
                    })
                      .then(() => {
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
                      })
                      .catch(() => undefined);
                  }}
                >
                  <Text style={[styles.buttonText, styles.buttonOnText]}>Wrap up day</Text>
                </Pressable>
              )}
            </>
          )}
          {undoReady ? (
            <Pressable
              style={styles.button}
              accessibilityLabel="Undo"
              testID="undo-mark"
              onPress={() => {
                void enqueue((database) => undoLastMark(database))
                  .then(() => setUndoReady(canUndoMark()))
                  .catch(() => undefined);
              }}
            >
              <Text style={styles.buttonText}>Undo</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={styles.button}
            accessibilityLabel={more ? "Less" : "More"}
            testID="more-controls"
            onPress={() => {
              setMore((open) => !open);
              setRestoreArmed(false);
            }}
          >
            <Text style={styles.buttonText}>{more ? "Less" : "More"}</Text>
          </Pressable>
        </View>
        {more || query.length > 0 || tagFilter != null ? (
          <>
            <TextInput
              testID="habit-search"
              accessibilityLabel="Search habits"
              value={query}
              onChangeText={setQuery}
              placeholder="Search habits"
              placeholderTextColor="#8A7A9E"
              autoCorrect={false}
              style={styles.search}
            />
            {tagChoices.length ? (
              <View style={styles.actions}>
                <Pressable
                  accessibilityLabel="All habits"
                  testID="tag-filter-all"
                  style={[styles.button, tagFilter == null && styles.buttonOn]}
                  onPress={() => setTagFilter(null)}
                >
                  <Text style={styles.buttonText}>All</Text>
                </Pressable>
                {tagChoices.map((tag) => (
                  <Pressable
                    key={tag}
                    accessibilityLabel={`Filter ${tag}`}
                    testID={`tag-filter-${testSlug(tag)}`}
                    style={[styles.button, tagFilter === tag && styles.buttonOn]}
                    onPress={() => setTagFilter(tag)}
                  >
                    <Text style={styles.buttonText}>{tag}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {review ? null : (
              <Pressable
                style={styles.button}
                accessibilityLabel="Evening reminder"
                testID="evening-reminder"
                onPress={() => setEveningOpen(true)}
              >
                <Text style={styles.buttonText}>
                  {evening ? `Evening ${formatClock12(evening.hour, evening.minute)}` : "Evening reminder"}
                </Text>
              </Pressable>
            )}
            <View style={styles.actions}>
              <Pressable
                style={styles.button}
                accessibilityLabel="Save backup"
                testID="save-backup"
                onPress={() => {
                  void enqueue(async (database) => {
                    const name = await saveBackup(database);
                    setBanner(`Saved ${name} on this phone.`);
                    setRestoreArmed(false);
                  }).catch(() => undefined);
                }}
              >
                <Text style={styles.buttonText}>Save backup</Text>
              </Pressable>
              {restoreArmed ? (
                <Pressable
                  style={styles.button}
                  accessibilityLabel="Confirm restore"
                  testID="confirm-restore"
                  onPress={() => {
                    const name = listBackupNames()[0];
                    if (!name) {
                      setBanner("No backup is saved on this phone.");
                      setRestoreArmed(false);
                      return;
                    }
                    void enqueue(async (database) => {
                      await restoreBackup(database, name);
                      setBanner("Restored on this phone.");
                      setRestoreArmed(false);
                    }).catch(() => undefined);
                  }}
                >
                  <Text style={styles.buttonText}>Confirm restore</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={styles.button}
                  accessibilityLabel="Restore latest"
                  testID="restore-backup"
                  onPress={() => setRestoreArmed(true)}
                >
                  <Text style={styles.buttonText}>Restore latest</Text>
                </Pressable>
              )}
            </View>
          </>
        ) : null}
        {banner ? <Text style={styles.banner}>{banner}</Text> : null}
      </View>
      <View style={styles.monthBar}>
        <Text style={styles.month} testID="month-title">
          {monthTitle(month.year, month.month)}
        </Text>
        {sample ? (
          <Text style={styles.quiet} testID="sample-month">
            Sample
          </Text>
        ) : null}
        {review && pastScore ? (
          <Pressable testID="month-score" accessibilityLabel="Month score" onPress={onOpenScore}>
            <Text style={styles.scorePercent}>
              {pastScore.percent == null ? "No closed days yet" : `${pastScore.percent}%`}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView style={styles.vertical} testID="row-scroll" nestedScrollEnabled>
        <View style={[styles.gridRow, { width: windowWidth }]}>
          <View style={{ width: labelWidth }}>
            <View style={[styles.corner, styles.line, { width: labelWidth }]}>
              <Text style={styles.cornerText}>Task</Text>
            </View>
            {visibleHabits.map((habit) => (
              <NameCell
                key={habit.id}
                habit={habit}
                locked={frozen}
                labelWidth={labelWidth}
                onDrop={
                  !needle && !tagFilter && !frozen ? (slots) => dropHabit(habit, slots) : undefined
                }
                onPress={() => {
                  if (frozen) return;
                  setTimeEdit(null);
                  setRenameTarget(habit);
                }}
              />
            ))}
          </View>
          <ScrollView
            horizontal
            ref={dayScrollRef}
            testID="day-scroll"
            nestedScrollEnabled
            directionalLockEnabled
            style={{ width: track, height: bodyHeight, flexGrow: 0 }}
            onContentSizeChange={revealToday}
          >
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
                      { width: dayWidth },
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
              {visibleHabits.map((habit) => (
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
                        dayWidth={dayWidth}
                        isWeekend={isWeekend(month.year, month.month, day)}
                        isToday={todayDay === day}
                        onPress={() => {
                          if (frozen) return;
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
                            if (outcome === "tick" || outcome === "cross") {
                              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
                                () => undefined,
                              );
                            }
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
                          if (frozen) return;
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
          isFirst={
            month.habits.filter((habit) => habit.pinned === editingHabit.pinned)[0]?.id ===
            editingHabit.id
          }
          isLast={
            month.habits.filter((habit) => habit.pinned === editingHabit.pinned).at(-1)?.id ===
            editingHabit.id
          }
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
          todayDate={
            editingHabit.entry === "checklist" && todayDay != null
              ? dateFor(month.year, month.month, todayDay)
              : null
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
            else if (editingHabit.entry === "timer") {
              const result = await syncDailyReminder({
                habitId: editingHabit.id,
                habitName: name,
                hour: editingHabit.reminderHour,
                minute: editingHabit.reminderMinute,
              });
              if (editingHabit.reminderHour != null && result === "unavailable") {
                setBanner("Saved. Allow notifications for MyDTC, or this reminder will not ring.");
              }
            }
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
          onPin={() => {
            void enqueue((database) =>
              setPinned(database, month.id, editingHabit.id, !editingHabit.pinned),
            ).catch(() => undefined);
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
              : `Daily reminder · ${timeEdit.habit.name}`
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
                if (result === "scheduled") {
                  setBanner(`Daily reminder set for ${formatClock12(hour, minute)}.`);
                }
                if (result === "stored") {
                  setBanner("Saved on this device. The browser will not notify you.");
                }
                if (result === "unavailable") {
                  setBanner("Saved. Allow notifications for MyDTC, or this reminder will not ring.");
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
          date={dateFor(month.year, month.month, journalEdit.day)}
          onClose={() => setJournalEdit(null)}
          onSave={async (note, photoPath, diary, voicePath) => {
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
                voicePath,
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
      {eveningOpen ? (
        <TimeDialog
          title="Evening reminder"
          hour={evening?.hour ?? null}
          minute={evening?.minute ?? null}
          onClose={() => setEveningOpen(false)}
          onSave={async (hour, minute) => {
            await enqueue(async (database) => {
              await writeSetting(database, EVENING_HOUR_KEY, String(hour));
              await writeSetting(database, EVENING_MINUTE_KEY, String(minute));
            });
            const result = await syncEveningWrap(hour, minute);
            setEvening({ hour, minute });
            setEveningOpen(false);
            if (result === "unavailable") setBanner("Saved. The notification was not scheduled.");
            if (result === "stored") setBanner("Saved on this device. The browser will not notify you.");
          }}
          onClear={async () => {
            await enqueue(async (database) => {
              await clearSetting(database, EVENING_HOUR_KEY);
              await clearSetting(database, EVENING_MINUTE_KEY);
            });
            await syncEveningWrap(null, null);
            setEvening(null);
            setEveningOpen(false);
          }}
        />
      ) : null}
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
  const pin = habit.pinned ? "Pinned" : "";
  const tags = habit.tags.join(" · ");
  return [pin, kind, tags].filter(Boolean).join(" · ");
}

function NameCell({
  habit,
  locked,
  labelWidth,
  onDrop,
  onPress,
}: {
  habit: Habit;
  locked: boolean;
  labelWidth: number;
  onDrop?: (slots: number) => void;
  onPress: () => void;
}) {
  const moved = useRef(0);
  const dropRef = useRef(onDrop);
  const lockedRef = useRef(locked);
  dropRef.current = onDrop;
  lockedRef.current = locked;
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: () => !lockedRef.current && dropRef.current != null,
      onPanResponderGrant: () => {
        moved.current = 0;
      },
      onPanResponderMove: (_event, gesture) => {
        moved.current = Math.round(gesture.dy / ROW_H);
      },
      onPanResponderRelease: () => {
        const slots = moved.current;
        moved.current = 0;
        dropRef.current?.(slots);
      },
    }),
  ).current;
  return (
    <View style={[styles.nameCell, styles.line, styles.nameRow, { height: ROW_H, width: labelWidth }]}>
      <Pressable
        disabled={locked}
        onPress={onPress}
        accessibilityLabel={habit.name}
        testID={`habit-${testSlug(habit.name)}`}
        style={styles.namePress}
      >
        <Text style={styles.habitName} numberOfLines={1}>
          {habit.name}
        </Text>
        <Text style={styles.kind} numberOfLines={1}>
          {rowSubtitle(habit)}
        </Text>
      </Pressable>
      {onDrop ? (
        <View
          {...pan.panHandlers}
          accessibilityLabel={`Drag ${habit.name}`}
          style={styles.grip}
        >
          <Text style={styles.kind}>Drag</Text>
        </View>
      ) : null}
    </View>
  );
}

function DayCell({
  habit,
  day,
  record,
  height,
  dayWidth,
  isWeekend,
  isToday,
  onPress,
  onLongPress,
}: {
  habit: Habit;
  day: number;
  record: DayRecord | undefined;
  height: number;
  dayWidth: number;
  isWeekend: boolean;
  isToday: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const slug = testSlug(habit.name);
  const shown = shownMark(habit.entry, record);
  const scale = useRef(new Animated.Value(1)).current;
  const seen = useRef(false);
  useEffect(() => {
    if (!seen.current) {
      seen.current = true;
      return;
    }
    scale.setValue(0.82);
    Animated.timing(scale, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [shown, scale]);
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
                : shown === "voice"
                  ? "voice"
                  : shown === "list"
                    ? checklistSummary(record?.checklist ?? [])
                    : "";
  return (
    <Pressable
      testID={`cell-${slug}-${day}`}
      accessibilityLabel={cellLabel(habit, day, record)}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.cell, styles.line, { height, width: dayWidth }, isWeekend && styles.weekend, isToday && styles.today]}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
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
      </Animated.View>
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
      title="Add habit"
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
  onPin,
  onMove,
  todayDate,
}: {
  habit: Habit;
  isFirst: boolean;
  isLast: boolean;
  onClose: () => void;
  onSave: (name: string, subtasks: CheckItem[] | null) => Promise<void>;
  subtasks: CheckItem[] | null;
  othersOnDay: number;
  todayDate: string | null;
  onRemove: () => Promise<void>;
  onToggleMiss: (value: boolean) => void;
  onCarry: (value: boolean) => void;
  onTags: (tags: string[]) => void;
  onFollowUp: (raw: string) => void;
  onRemind: () => void;
  onPin: () => void;
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
  const [reminderOn, setReminderOn] = useState(false);
  useEffect(() => {
    if (habit.entry !== "timer" || habit.reminderHour == null || habit.reminderMinute == null) {
      setReminderOn(false);
      return;
    }
    let live = true;
    void reminderIsScheduled(habit.id).then((on) => {
      if (live) setReminderOn(on);
    });
    return () => {
      live = false;
    };
  }, [habit.entry, habit.id, habit.reminderHour, habit.reminderMinute]);

  useEffect(() => {
    if (!subtasks) return;
    let live = true;
    void openAppDatabase()
      .then(async (database) => {
        const list = await listAllowsMore(database, habit.id);
        const day = todayDate ? await dayAllowsMore(database, todayDate) : false;
        return { list, day };
      })
      .then((room) => {
        if (!live) return;
        if (room.list) setAcceptedOver3(true);
        if (room.day) setAcceptedOver12(true);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [habit.id, subtasks, todayDate]);

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
      cover
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
                  if (todayDate) {
                    void openAppDatabase()
                      .then((database) => allowMoreOnDay(database, todayDate))
                      .catch(() => undefined);
                  }
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
                  void openAppDatabase()
                    .then((database) => allowMoreOnList(database, habit.id))
                    .catch(() => undefined);
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
          <Text style={styles.sheetHeading} accessibilityRole="header" testID="subtasks-heading">
            Subtasks
          </Text>
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
        <Pressable
          testID={`remind-${slug}`}
          style={styles.button}
          accessibilityLabel={
            habit.reminderHour == null
              ? "Daily reminder"
              : reminderOn
                ? `Daily reminder ${remind}`
                : "Reminder not on"
          }
          onPress={onRemind}
        >
          <Text style={styles.buttonText}>
            {habit.reminderHour == null
              ? "Daily reminder"
              : reminderOn
                ? `Daily reminder ${remind}`
                : "Reminder not on"}
          </Text>
        </Pressable>
      ) : null}
      <View style={styles.actions}>
        <Pressable
          style={styles.button}
          accessibilityLabel={habit.pinned ? "Unpin" : "Pin"}
          testID={`pin-${slug}`}
          onPress={onPin}
        >
          <Text style={styles.buttonText}>{habit.pinned ? "Unpin" : "Pin"}</Text>
        </Pressable>
        <Pressable style={styles.button} accessibilityLabel="Move up" disabled={isFirst} onPress={() => onMove("up")}>
          <Text style={styles.buttonText}>Move up</Text>
        </Pressable>
        <Pressable style={styles.button} accessibilityLabel="Move down" disabled={isLast} onPress={() => onMove("down")}>
          <Text style={styles.buttonText}>Move down</Text>
        </Pressable>
      </View>
      {message ? <Text style={styles.banner}>{message}</Text> : null}
    </Dialog>
  );
}

function initialDigits(hour: number | null, minute: number | null): string {
  if (hour == null || minute == null) return "";
  const view = to12Hour(hour);
  return `${view.hour12}${String(minute).padStart(2, "0")}`;
}

function formatTypedClock(digits: string): string {
  if (digits.length <= 2) return digits;
  if (digits.length === 3) return `${digits.slice(0, 1)}:${digits.slice(1)}`;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

/** Three digits are hour and minute, and the chosen AM or PM stays. Four digits from 13 onward set the half of the day. */
function clockFromDigits(
  digits: string,
  period: ClockPeriod,
): { hour12: number; minute: number; period: ClockPeriod } | null {
  if (digits.length < 3) return null;
  const parsed = parseTimeInput(digits);
  if (!parsed) return null;
  if (digits.length === 4 && (parsed.hour === 0 || parsed.hour > 12)) {
    const view = to12Hour(parsed.hour);
    return { hour12: view.hour12, minute: parsed.minute, period: view.period };
  }
  const hour12 = parsed.hour === 0 ? 12 : parsed.hour;
  if (hour12 < 1 || hour12 > 12) return null;
  return { hour12, minute: parsed.minute, period };
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
  const [digits, setDigits] = useState(initialDigits(hour, minute));
  const [period, setPeriod] = useState<ClockPeriod>(initial?.period ?? "AM");
  const [clock, setClock] = useState<{ hour12: number; minute: number } | null>(
    initial ? { hour12: initial.hour12, minute: minute ?? 0 } : null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const full = clock ? to24Hour(clock.hour12, clock.minute, period) : null;

  function onDigits(text: string) {
    const next = text.replace(/\D/g, "").slice(0, 4);
    setDigits(next);
    setMessage(null);
    const applied = clockFromDigits(next, period);
    if (!applied) {
      setClock(null);
      return;
    }
    setClock({ hour12: applied.hour12, minute: applied.minute });
    if (applied.period !== period) setPeriod(applied.period);
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <Text style={styles.clock} testID="clock-preview">
        {full ? formatClock12(full.hour, full.minute) : digits ? formatTypedClock(digits) : "5:07"}
      </Text>
      <TextInput
        testID="time-input"
        accessibilityLabel="Time"
        value={formatTypedClock(digits)}
        onChangeText={onDigits}
        placeholder="507"
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={5}
        autoCorrect={false}
        style={styles.input}
      />
      <View style={styles.actions}>
        <Pressable
          testID="time-now"
          accessibilityLabel="Now"
          style={[styles.button, styles.buttonOn]}
          onPress={() => {
            const now = new Date();
            const view = to12Hour(now.getHours());
            const minute = now.getMinutes();
            const next = to24Hour(view.hour12, minute, view.period);
            if (!next) return;
            setPeriod(view.period);
            setDigits(`${view.hour12}${String(minute).padStart(2, "0")}`);
            setClock({ hour12: view.hour12, minute });
            void onSave(next.hour, next.minute).catch((error: unknown) => setMessage(errorText(error)));
          }}
        >
          <Text style={[styles.buttonText, styles.buttonOnText]}>Now</Text>
        </Pressable>
        <Pressable
          testID="period-am"
          accessibilityLabel="AM"
          style={[styles.button, period === "AM" && styles.buttonOn]}
          onPress={() => setPeriod("AM")}
        >
          <Text style={[styles.buttonText, period === "AM" && styles.buttonOnText]}>AM</Text>
        </Pressable>
        <Pressable
          testID="period-pm"
          accessibilityLabel="PM"
          style={[styles.button, period === "PM" && styles.buttonOn]}
          onPress={() => setPeriod("PM")}
        >
          <Text style={[styles.buttonText, period === "PM" && styles.buttonOnText]}>PM</Text>
        </Pressable>
      </View>
      <Text style={styles.quiet}>Type 507 for 5:07. The colon is added.</Text>
      {message ? <Text style={styles.banner}>{message}</Text> : null}
      <View style={styles.actions}>
        <Pressable
          style={styles.button}
          testID="time-save"
          onPress={() => {
            if (!full) {
              setMessage("Use 507 for 5:07.");
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
  date,
  record,
  onClose,
  onSave,
}: {
  habit: Habit;
  day: number;
  date: string;
  record: DayRecord | undefined;
  onClose: () => void;
  onSave: (note: string, photoPath: string | null, diary: boolean, voicePath: string | null) => Promise<void>;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [note, setNote] = useState(record?.note ?? "");
  const keptPhoto = keepPhotoFile(record?.photoPath);
  const keptVoice = keepVoiceFile(record?.voicePath);
  const [photoPath, setPhotoPath] = useState<string | null>(keptPhoto);
  const [voicePath, setVoicePath] = useState<string | null>(keptVoice);
  const [recording, setRecording] = useState(false);
  const [diary, setDiary] = useState(record?.diaryMark ?? false);
  const [message, setMessage] = useState<string | null>(record?.photoPath && !keptPhoto ? PHOTO_REFUSED : null);

  async function toggleVoice() {
    try {
      if (recording) {
        await recorder.stop();
        setRecording(false);
        const uri = recorder.uri;
        if (!uri) {
          setMessage(VOICE_REFUSED);
          return;
        }
        setVoicePath(await storeVoiceNote(habit.id, date, uri));
        setMessage(null);
        return;
      }
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setMessage("The microphone is off. The note can still be saved.");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      setMessage(null);
    } catch {
      setRecording(false);
      setMessage(VOICE_REFUSED);
    }
  }

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
          accessibilityLabel={photoPath ? "Replace photo" : "Attach photo"}
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
            accessibilityLabel="Remove photo"
            onPress={() => {
              forgetJournalPhoto(photoPath);
              setPhotoPath(null);
            }}
          >
            <Text style={styles.buttonText}>Remove photo</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={styles.button}
          accessibilityLabel={recording ? "Stop voice note" : "Record voice note"}
          testID="journal-voice"
          onPress={() => {
            void toggleVoice();
          }}
        >
          <Text style={styles.buttonText}>{recording ? "Stop voice note" : voicePath ? "Replace voice note" : "Record voice note"}</Text>
        </Pressable>
        {voicePath && !recording ? (
          <Pressable
            style={styles.button}
            accessibilityLabel="Remove voice note"
            onPress={() => setVoicePath(null)}
          >
            <Text style={styles.buttonText}>Remove voice note</Text>
          </Pressable>
        ) : null}
        <Pressable style={[styles.button, diary && styles.buttonOn]} onPress={() => setDiary((value) => !value)}>
          <Text style={[styles.buttonText, diary && styles.buttonOnText]}>Wrote it in my diary</Text>
        </Pressable>
      </View>
      {message ? (
        <Text style={styles.banner} testID="journal-message">
          {message}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Pressable
          style={styles.button}
          onPress={() => {
            void onSave(note, photoPath, diary, voicePath).catch((error: unknown) => setMessage(errorText(error)));
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
  date,
  items,
  othersOnDay,
  onClose,
  onSave,
}: {
  habit: Habit;
  day: number;
  date: string;
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

  useEffect(() => {
    let live = true;
    void openAppDatabase()
      .then(async (database) => {
        const list = await listAllowsMore(database, habit.id);
        const room = await dayAllowsMore(database, date);
        return { list, room };
      })
      .then((known) => {
        if (!live) return;
        if (known.list) setAcceptedOver3(true);
        if (known.room) setAcceptedOver12(true);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [habit.id, date]);

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
    void openAppDatabase()
      .then((database) => allowMoreOnList(database, habit.id))
      .catch(() => undefined);
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
    void openAppDatabase()
      .then((database) => allowMoreOnDay(database, date))
      .catch(() => undefined);
    void onSave(lines).catch((error: unknown) => setMessage(errorText(error)));
  }

  return (
    <View style={styles.sheet} testID="checklist-sheet">
      <Text style={styles.month} accessibilityRole="header">
        {habit.name}
      </Text>
      <ScrollView style={styles.sheetBody} keyboardShouldPersistTaps="handled">
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
      </ScrollView>
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
    </View>
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
  cover = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  cover?: boolean;
}) {
  return (
    <Modal transparent animationType={cover ? "none" : "fade"} onRequestClose={onClose}>
      <View style={[styles.modalBackdrop, cover && styles.modalCover]}>
        <View style={[styles.modalCard, cover && styles.modalCoverCard]}>
          <Text style={styles.modalTitle}>{title}</Text>
          <ScrollView
            style={[styles.modalBody, cover && styles.modalCoverBody]}
            keyboardShouldPersistTaps="handled"
          >
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
  screen: { flex: 1, minHeight: 0, backgroundColor: "#16121C" },
  controls: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  monthBar: { paddingHorizontal: 16, marginTop: 16, marginBottom: 8 },
  sheet: { flex: 1, minHeight: 0, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  sheetBody: { flex: 1, minHeight: 0 },
  scorePercent: { fontSize: 40, fontWeight: "800", color: "#F6F1FF" },
  month: { fontSize: 22, color: "#F6F1FF", fontWeight: "700", lineHeight: 28 },
  hint: { marginTop: 8, color: "#D9CCEA", fontSize: 13, lineHeight: 18 },
  quiet: { marginTop: 8, color: "#8E819C", fontSize: 13, lineHeight: 18 },
  ask: { marginTop: 12, color: "#F6F1FF", fontSize: 16, lineHeight: 22, fontWeight: "700" },
  banner: { marginTop: 8, color: "#FF8AA0", fontSize: 14 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 0 },
  search: {
    height: 44,
    borderWidth: 1,
    borderColor: "#3A3348",
    borderRadius: 10,
    paddingHorizontal: 12,
    color: "#F6F1FF",
    backgroundColor: "#16121C",
    fontSize: 16,
  },
  button: {
    minHeight: 44,
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
  vertical: { flex: 1, minHeight: 0 },
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
    paddingLeft: 12,
    backgroundColor: "#1C1726",
    borderLeftWidth: 1,
  },
  nameRow: { flexDirection: "row", alignItems: "center" },
  namePress: { flex: 1, justifyContent: "center", minHeight: 44 },
  grip: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  habitName: { color: "#FFFFFF", fontSize: 17, fontWeight: "700" },
  kind: { color: "#8E819C", fontSize: 11, marginTop: 2 },
  fieldLabel: {
    marginTop: 14,
    marginBottom: 6,
    color: "#D9CCEA",
    fontSize: 12,
    fontWeight: "600",
  },
  sheetHeading: {
    alignSelf: "stretch",
    marginTop: 4,
    marginBottom: 8,
    paddingVertical: 4,
    backgroundColor: "#16121C",
    color: "#F6F1FF",
    fontSize: 22,
    fontWeight: "800",
    lineHeight: 28,
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
  modalCover: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "#16121C",
    padding: 16,
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
  modalCoverCard: {
    flex: 1,
    maxWidth: "100%",
    maxHeight: "100%",
    width: "100%",
    backgroundColor: "#16121C",
    borderWidth: 0,
    borderRadius: 0,
  },
  modalBody: { flexShrink: 1 },
  modalCoverBody: { flex: 1, minHeight: 0 },
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
