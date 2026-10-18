import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Modal,
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
  setBlankCountsAsMiss,
  setLocked,
  setTime,
} from "./db";
import { errorText } from "./errors";
import { dateFor, monthTitle } from "./month";
import { isReservedTimeName, NAME_MAX, testSlug } from "./names";
import { countsAsMiss, shownMark } from "./tally";
import { formatClock, parseTimeInput } from "./time";
import type { DayRecord, Entry, Habit, MonthState } from "./types";

const LABEL_W = 248;
const DAY_W = 46;
const ROW_H = 124;
const HEADER_H = 40;
const DAY_COUNT = 31;
const DAYS = Array.from({ length: DAY_COUNT }, (_, index) => index + 1);

export function MonthScreen() {
  const windowWidth = useWindowDimensions().width;
  const dbRef = useRef<SQLiteDatabase | null>(null);
  const queue = useRef(Promise.resolve());
  const [month, setMonth] = useState<MonthState | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [timeEdit, setTimeEdit] = useState<{ habit: Habit; day: number } | null>(null);
  const [renameEdit, setRenameEdit] = useState<Habit | null>(null);

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
    for (const record of month?.records ?? []) {
      map.set(`${record.habitId}|${record.date}`, record);
    }
    return map;
  }, [month]);

  function enqueue(task: (database: SQLiteDatabase) => Promise<void>): Promise<void> {
    const database = dbRef.current;
    if (!database || !month) return Promise.resolve();
    const run = queue.current.then(async () => {
      await task(database);
      setMonth(await loadMonth(database));
      setBanner(null);
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
  const bodyHeight = HEADER_H + Math.max(1, month.habits.length) * ROW_H;

  return (
    <SafeAreaView style={styles.screen} testID="month-grid">
      <View style={styles.top}>
        <Text style={styles.title}>Pencheck</Text>
        <Text style={styles.month} testID="month-title">
          {monthTitle(month.year, month.month)}
        </Text>
        <Text style={styles.hint}>
          Days 1–31 scroll sideways. Add a row as Tick or Time. A tick cycles blank, tick, then
          cross. A time stores a value such as 630.
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
        </View>
        <Text style={styles.hint}>
          {month.locked
            ? "Rows are locked. You can still mark days."
            : "Tap a name to rename it. Up and down change the order."}
        </Text>
        {banner ? <Text style={styles.banner}>{banner}</Text> : null}
      </View>

      <ScrollView style={styles.vertical} contentContainerStyle={styles.verticalContent}>
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
                onRename={() => setRenameEdit(habit)}
                onToggleMiss={(value) => {
                  void enqueue((database) =>
                    setBlankCountsAsMiss(database, month.id, habit.id, value),
                  ).catch(() => undefined);
                }}
                onMove={(direction) => {
                  void enqueue((database) =>
                    moveHabit(database, month.id, habit.id, direction),
                  ).catch(() => undefined);
                }}
              />
            ))}
          </View>
          <ScrollView
            horizontal
            testID="day-scroll"
            style={{ width: gridWidth, height: bodyHeight }}
            nestedScrollEnabled
          >
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
                        isToday={todayDay === day}
                        onPress={() => {
                          if (habit.entry === "time") {
                            setTimeEdit({ habit, day });
                            return;
                          }
                          void enqueue((database) =>
                            cycleTick(database, month.id, habit.id, month.year, month.month, day),
                          ).catch(() => undefined);
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
          onSave={async (name, entry) => {
            await enqueue((database) => addHabit(database, month.id, name, entry));
            setAddOpen(false);
          }}
        />
      ) : null}
      {renameEdit ? (
        <RenameDialog
          habit={renameEdit}
          onClose={() => setRenameEdit(null)}
          onSave={async (name) => {
            await enqueue((database) => renameHabit(database, month.id, renameEdit.id, name));
            setRenameEdit(null);
          }}
          onRemove={async () => {
            await enqueue((database) => removeHabit(database, month.id, renameEdit.id));
            setRenameEdit(null);
          }}
        />
      ) : null}
      {timeEdit ? (
        <TimeDialog
          key={`${timeEdit.habit.id}-${timeEdit.day}`}
          habit={timeEdit.habit}
          day={timeEdit.day}
          record={records.get(
            `${timeEdit.habit.id}|${dateFor(month.year, month.month, timeEdit.day)}`,
          )}
          onClose={() => setTimeEdit(null)}
          onSave={async (raw) => {
            await enqueue((database) =>
              setTime(
                database,
                month.id,
                timeEdit.habit.id,
                month.year,
                month.month,
                timeEdit.day,
                raw,
              ),
            );
            setTimeEdit(null);
          }}
          onClear={async () => {
            await enqueue((database) =>
              clearCell(
                database,
                month.id,
                timeEdit.habit.id,
                month.year,
                month.month,
                timeEdit.day,
              ),
            );
            setTimeEdit(null);
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
  onRename,
  onToggleMiss,
  onMove,
}: {
  habit: Habit;
  locked: boolean;
  isFirst: boolean;
  isLast: boolean;
  onRename: () => void;
  onToggleMiss: (value: boolean) => void;
  onMove: (direction: "up" | "down") => void;
}) {
  const slug = testSlug(habit.name);
  return (
    <View style={[styles.nameCell, styles.line]}>
      <Pressable onPress={onRename} disabled={locked} testID={`habit-${slug}`}>
        <Text style={styles.habitName} numberOfLines={2}>
          {habit.name}
        </Text>
        <Text style={styles.kind}>{habit.entry === "time" ? "time" : "tick"}</Text>
      </Pressable>
      <Pressable
        testID={`miss-flag-${slug}`}
        onPress={() => onToggleMiss(!habit.blankCountsAsMiss)}
        accessibilityState={{ checked: habit.blankCountsAsMiss }}
      >
        <Text style={styles.missFlag}>
          {habit.blankCountsAsMiss ? "[x]" : "[ ]"} Empty day counts as a miss
        </Text>
      </Pressable>
      {locked ? null : (
        <View style={styles.reorder}>
          <Pressable disabled={isFirst} onPress={() => onMove("up")} hitSlop={6}>
            <Text style={[styles.link, isFirst && styles.linkOff]}>Up</Text>
          </Pressable>
          <Pressable disabled={isLast} onPress={() => onMove("down")} hitSlop={6}>
            <Text style={[styles.link, isLast && styles.linkOff]}>Down</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function DayCell({
  habit,
  day,
  record,
  isToday,
  onPress,
}: {
  habit: Habit;
  day: number;
  record: DayRecord | undefined;
  isToday: boolean;
  onPress: () => void;
}) {
  const slug = testSlug(habit.name);
  const shown = shownMark(habit.entry, record?.display);
  return (
    <Pressable
      testID={`cell-${slug}-${day}`}
      accessibilityLabel={cellLabel(habit, day, record)}
      onPress={onPress}
      style={[styles.cell, styles.line, isToday && styles.today]}
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
        {markGlyph(shown, record?.display)}
      </Text>
    </Pressable>
  );
}

function AddDialog({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (name: string, entry: Entry) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<Entry>("tick");
  const [message, setMessage] = useState<string | null>(null);
  const reserved = isReservedTimeName(name);
  const entry: Entry = reserved ? "time" : chosen;
  return (
    <Dialog title="Add row" onClose={onClose}>
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
        <Pressable
          testID="add-kind-tick"
          disabled={reserved}
          onPress={() => setChosen("tick")}
          style={[styles.button, entry === "tick" && styles.buttonOn, reserved && styles.buttonOff]}
        >
          <Text style={[styles.buttonText, entry === "tick" && styles.buttonOnText]}>Tick</Text>
        </Pressable>
        <Pressable
          testID="add-kind-time"
          onPress={() => setChosen("time")}
          style={[styles.button, entry === "time" && styles.buttonOn]}
        >
          <Text style={[styles.buttonText, entry === "time" && styles.buttonOnText]}>Time</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>
        {reserved
          ? "Wake up and Sleep Time are time rows."
          : entry === "time"
            ? "A time stores a value such as 630. It does not take a tick or a cross."
            : "A tick cycles blank, tick, then cross."}
      </Text>
      {message ? <Text style={styles.banner}>{message}</Text> : null}
      <View style={styles.actions}>
        <Pressable
          style={styles.button}
          testID="add-save"
          onPress={() => {
            void onSave(name, entry).catch((error: unknown) => setMessage(errorText(error)));
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
  const becomesTime = habit.entry === "tick" && isReservedTimeName(name);
  return (
    <Dialog title="Rename row" onClose={onClose}>
      <TextInput
        testID="rename-input"
        value={name}
        onChangeText={(value) => {
          setName(value);
          setMessage(null);
        }}
        maxLength={NAME_MAX}
        autoCorrect={false}
        style={styles.input}
      />
      {becomesTime ? (
        <Text style={styles.hint}>This becomes a time row. Marks on it will be cleared.</Text>
      ) : null}
      {message ? <Text style={styles.banner}>{message}</Text> : null}
      <View style={styles.actions}>
        <Pressable
          style={styles.button}
          testID="rename-save"
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
  habit,
  day,
  record,
  onClose,
  onSave,
  onClear,
}: {
  habit: Habit;
  day: number;
  record: DayRecord | undefined;
  onClose: () => void;
  onSave: (raw: string) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const initial = record && record.display !== "tick" && record.display !== "cross" ? record.display : "";
  const [draft, setDraft] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const parsed = parseTimeInput(draft);
  return (
    <Dialog title={`${habit.name} · day ${day}`} onClose={onClose}>
      <TextInput
        testID="time-input"
        value={draft}
        onChangeText={(value) => {
          setDraft(value);
          setMessage(null);
        }}
        placeholder="630"
        maxLength={5}
        autoCorrect={false}
        autoCapitalize="none"
        style={styles.input}
      />
      <Text style={styles.hint} testID="clock-preview">
        {parsed
          ? `24-hour clock: ${formatClock(parsed.hour, parsed.minute)}`
          : "Type 630 for 06:30, or 18:30. The cell keeps what you type."}
      </Text>
      {message ? <Text style={styles.banner}>{message}</Text> : null}
      <View style={styles.actions}>
        <Pressable
          style={styles.button}
          testID="time-save"
          onPress={() => {
            void onSave(draft).catch((error: unknown) => setMessage(errorText(error)));
          }}
        >
          <Text style={styles.buttonText}>Save</Text>
        </Pressable>
        {record ? (
          <Pressable
            style={styles.button}
            testID="time-clear"
            onPress={() => {
              void onClear().catch((error: unknown) => setMessage(errorText(error)));
            }}
          >
            <Text style={styles.buttonText}>Clear</Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.button} testID="time-cancel" onPress={onClose}>
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

function markGlyph(shown: ReturnType<typeof shownMark>, display: string | undefined): string {
  if (shown === "tick") return "✓";
  if (shown === "cross") return "✕";
  if (shown === "time") return display ?? "";
  return "";
}

function cellLabel(habit: Habit, day: number, record: DayRecord | undefined): string {
  const shown = shownMark(habit.entry, record?.display);
  if (shown === "blank") {
    return countsAsMiss(habit.entry, habit.blankCountsAsMiss, record?.display)
      ? `${habit.name}, day ${day}, empty, counts as a miss`
      : `${habit.name}, day ${day}, empty`;
  }
  if (shown === "tick") return `${habit.name}, day ${day}, tick`;
  if (shown === "cross") return `${habit.name}, day ${day}, cross`;
  if (record?.clockHour != null && record.clockMinute != null) {
    return `${habit.name}, day ${day}, ${record.display}, ${formatClock(record.clockHour, record.clockMinute)}`;
  }
  return `${habit.name}, day ${day}, ${record?.display ?? ""}`;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f6f1e7",
  },
  top: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1c2834",
  },
  month: {
    marginTop: 2,
    fontSize: 16,
    color: "#23415c",
    fontWeight: "600",
  },
  hint: {
    marginTop: 6,
    color: "#5c6570",
    fontSize: 13,
    lineHeight: 18,
  },
  banner: {
    marginTop: 8,
    color: "#8d2f2f",
    fontSize: 14,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  button: {
    borderWidth: 1,
    borderColor: "#23415c",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#fffdf8",
  },
  buttonText: {
    color: "#23415c",
    fontSize: 14,
    fontWeight: "600",
  },
  vertical: {
    flex: 1,
  },
  verticalContent: {
    paddingBottom: 24,
  },
  gridRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  line: {
    borderColor: "#d3cdc2",
    borderRightWidth: 1,
    borderBottomWidth: 1,
  },
  corner: {
    width: LABEL_W,
    height: HEADER_H,
    justifyContent: "center",
    paddingHorizontal: 10,
    backgroundColor: "#efe8d8",
    borderTopWidth: 1,
    borderLeftWidth: 1,
  },
  cornerText: {
    color: "#1c2834",
    fontWeight: "700",
    fontSize: 13,
  },
  nameCell: {
    width: LABEL_W,
    height: ROW_H,
    justifyContent: "center",
    paddingHorizontal: 10,
    backgroundColor: "#f3ecdf",
    borderLeftWidth: 1,
  },
  habitName: {
    color: "#1c2834",
    fontSize: 15,
    fontWeight: "600",
  },
  kind: {
    color: "#5c6570",
    fontSize: 11,
    marginTop: 2,
  },
  missFlag: {
    color: "#1c2834",
    fontSize: 11,
    lineHeight: 14,
    marginTop: 4,
  },
  buttonOn: {
    backgroundColor: "#23415c",
  },
  buttonOnText: {
    color: "#fffdf8",
  },
  buttonOff: {
    opacity: 0.4,
  },
  reorder: {
    flexDirection: "row",
    gap: 12,
    marginTop: 4,
  },
  link: {
    color: "#23415c",
    fontSize: 12,
    fontWeight: "600",
  },
  linkOff: {
    color: "#b7b1a6",
  },
  dayHeaderRow: {
    flexDirection: "row",
  },
  dayHeader: {
    width: DAY_W,
    height: HEADER_H,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#efe8d8",
    borderTopWidth: 1,
  },
  dayText: {
    color: "#1c2834",
    fontSize: 13,
    fontWeight: "600",
  },
  cell: {
    width: DAY_W,
    height: ROW_H,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fffdf8",
  },
  today: {
    backgroundColor: "#d9e6f2",
  },
  todayText: {
    color: "#18324d",
    fontWeight: "700",
  },
  mark: {
    fontSize: 18,
    color: "#1c2834",
  },
  tick: {
    color: "#1f6b3a",
    fontSize: 22,
    fontWeight: "700",
  },
  cross: {
    color: "#8d2f2f",
    fontSize: 22,
    fontWeight: "700",
  },
  timeMark: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1c2834",
  },
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
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1c2834",
    marginBottom: 8,
  },
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
});
