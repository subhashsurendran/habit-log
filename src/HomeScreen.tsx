import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { BrandLockup } from "./BrandLockup";
import {
  DISPLAY_NAME_KEY,
  loadDashboard,
  markDoneToday,
  openAppDatabase,
  writeSetting,
  type DashboardState,
} from "./db";
import { errorText, logOpenFailed, OPEN_FAILED } from "./errors";
import { greetingLine } from "./greet";
import { dateFor, monthTitle } from "./month";
import { validateCallName } from "./names";
import { syncFollowUp } from "./notify";
import { openTodayHabits, scoreStoredMonth, type OpenHabit } from "./score";
import { ui } from "./theme";

export function HomeScreen({
  name,
  onName,
  onOpenToday,
  onAddHabit,
  onOpenMonth,
  onGesture,
}: {
  name: string | null;
  onName: (name: string) => void;
  onOpenToday: () => void;
  onAddHabit: () => void;
  onOpenMonth: (monthId: string) => void;
  onGesture: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [board, setBoard] = useState<DashboardState | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    openAppDatabase()
      .then((database) => loadDashboard(database))
      .then((next) => {
        if (live) setBoard(next);
      })
      .catch(() => {
        if (!live) return;
        logOpenFailed();
        setFatal(OPEN_FAILED);
      });
    return () => {
      live = false;
    };
  }, []);

  function saveName() {
    onGesture();
    let next: string;
    try {
      next = validateCallName(draft);
    } catch (error: unknown) {
      setBanner(errorText(error));
      return;
    }
    void openAppDatabase()
      .then((database) => writeSetting(database, DISPLAY_NAME_KEY, next))
      .then(() => {
        onName(next);
        setDraft("");
        setBanner(null);
      })
      .catch((error: unknown) => setBanner(errorText(error)));
  }

  function markOpen(habit: OpenHabit) {
    if (!board) return;
    onGesture();
    const today = new Date();
    const monthId = board.current.id;
    void openAppDatabase()
      .then(async (database) => {
        const entry = await markDoneToday(database, monthId, habit.id, today);
        if (!entry) {
          setBanner("Add a line on Today first.");
          return;
        }
        if (entry === "tick" || entry === "timer") {
          const result = await syncFollowUp({
            habitId: habit.id,
            habitName: habit.name,
            date: dateFor(today.getFullYear(), today.getMonth() + 1, today.getDate()),
            hours: habit.followUpHours,
            completed: true,
          });
          setBanner(result === "unavailable" ? "Saved. The notification was not scheduled." : null);
        } else {
          setBanner(null);
        }
        setBoard(await loadDashboard(database));
      })
      .catch((error: unknown) => setBanner(errorText(error)));
  }

  const score = board ? scoreStoredMonth(board.current) : null;
  const open = board ? openTodayHabits(board.current) : [];
  const habitCount = board?.current.habits.length ?? 0;

  return (
    <ScrollView
      style={ui.screen}
      contentContainerStyle={ui.page}
      keyboardShouldPersistTaps="handled"
      testID="home-screen"
    >
      <BrandLockup />
      {name ? (
        <Text style={[ui.title, { textAlign: "center" }]} testID="greeting">
          {greetingLine(name)}
        </Text>
      ) : (
        <View style={ui.stack}>
          <Text style={[ui.title, { textAlign: "center" }]}>What should I call you?</Text>
          <TextInput
            testID="call-name"
            value={draft}
            onChangeText={(value) => {
              setDraft(value);
              setBanner(null);
            }}
            onFocus={onGesture}
            onSubmitEditing={saveName}
            placeholder="Name"
            placeholderTextColor="#8A7A9E"
            maxLength={40}
            autoCorrect={false}
            autoCapitalize="words"
            style={ui.input}
          />
          <Pressable style={[ui.button, { alignSelf: "center" }]} testID="call-save" onPress={saveName}>
            <Text style={ui.buttonText}>Save</Text>
          </Pressable>
        </View>
      )}
      <View style={ui.card} testID="home-score">
        <Text style={ui.section}>This month</Text>
        {fatal ? <Text style={ui.body}>{fatal}</Text> : null}
        {!fatal && !score ? <Text style={ui.body}>Opening…</Text> : null}
        {score && score.percent == null ? <Text style={ui.body}>No closed days yet</Text> : null}
        {score && score.percent != null ? <Text style={ui.percent}>{score.percent}%</Text> : null}
      </View>
      {board && habitCount > 0 && open.length === 0 ? (
        <Text style={ui.quiet} testID="done-for-today">
          Done for today.
        </Text>
      ) : null}
      {open.length ? (
        <View style={ui.stack} testID="open-today">
          <Text style={ui.section}>
            {open.length} still open today
          </Text>
          {open.map((habit) => (
            <View key={habit.id} style={ui.row}>
              <Text style={[ui.body, { flex: 1 }]}>{habit.name}</Text>
              <Pressable
                style={ui.button}
                accessibilityLabel={`Done, ${habit.name}`}
                testID={`open-done-${habit.id}`}
                onPress={() => markOpen(habit)}
              >
                <Text style={ui.buttonText}>Done</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <Pressable
        style={ui.primary}
        accessibilityLabel="Track today"
        testID="track-today"
        onPress={() => {
          onGesture();
          onOpenToday();
        }}
      >
        <Text style={ui.primaryText}>Track today</Text>
      </Pressable>
      <Pressable
        style={[ui.button, { alignSelf: "center" }]}
        accessibilityLabel="Add habit"
        testID="add-habit"
        onPress={() => {
          onGesture();
          onAddHabit();
        }}
      >
        <Text style={ui.buttonText}>Add habit</Text>
      </Pressable>
      {board && board.past.length ? (
        <View style={ui.stack} testID="past-months">
          <Text style={ui.section}>Past months</Text>
          {board.past.map((month) => (
            <Pressable
              key={month.id}
              style={ui.button}
              accessibilityLabel={monthTitle(month.year, month.month)}
              testID={`past-${month.id}`}
              onPress={() => {
                onGesture();
                onOpenMonth(month.id);
              }}
            >
              <Text style={ui.buttonText}>{monthTitle(month.year, month.month)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {banner ? <Text style={ui.banner}>{banner}</Text> : null}
    </ScrollView>
  );
}
