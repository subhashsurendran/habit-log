import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { addHabit, loadDashboard, openAppDatabase, type DashboardState } from "./db";
import { errorText, logOpenFailed, OPEN_FAILED } from "./errors";
import { HABIT_SUGGESTIONS, suggestionAt, suggestionsNotKept, type HabitSuggestion } from "./suggestions";
import { ui } from "./theme";
import type { Entry } from "./types";

function kindLabel(entry: Entry): string {
  if (entry === "tick") return "Tick";
  if (entry === "timer") return "Timer";
  if (entry === "journal") return "Journal";
  return "Checklist";
}

export function IdeasScreen({ onGesture }: { onGesture: () => void }) {
  const [board, setBoard] = useState<DashboardState | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  function reload() {
    return openAppDatabase().then((database) => loadDashboard(database));
  }

  useEffect(() => {
    let live = true;
    reload()
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

  function add(item: HabitSuggestion) {
    if (!board) return;
    onGesture();
    void openAppDatabase()
      .then((database) => addHabit(database, board.current.id, item.name, item.entry, []))
      .then(() => reload())
      .then((next) => {
        setBoard(next);
        setBanner(`${item.name} is on this month.`);
      })
      .catch((error: unknown) => setBanner(errorText(error)));
  }

  const names = board?.current.habits.map((habit) => habit.name) ?? [];
  const gist = suggestionAt(HABIT_SUGGESTIONS, 0);
  const rest = HABIT_SUGGESTIONS.filter((item) => item.name !== gist?.name);
  const waiting = suggestionsNotKept(names);

  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.page} testID="ideas-screen">
      <Text style={ui.title} accessibilityRole="header">
        What's kept
      </Text>
      <Text style={ui.quiet}>
        Habits people add in many countries. This phone only changes your month.
      </Text>
      {fatal ? <Text style={ui.body}>{fatal}</Text> : null}
      {!fatal && !board ? <Text style={ui.body}>Opening…</Text> : null}
      {board && waiting.length === 0 ? (
        <Text style={ui.body} testID="ideas-all-kept">
          These are all on this month.
        </Text>
      ) : null}
      {gist ? (
        <View style={ui.stack}>
          <Text style={ui.section}>Today's gist</Text>
          <IdeaCard item={gist} names={names} onAdd={add} />
        </View>
      ) : null}
      {rest.length ? (
        <View style={ui.stack}>
          <Text style={ui.section}>Also kept</Text>
          {rest.map((item) => (
            <IdeaCard key={item.name} item={item} names={names} onAdd={add} />
          ))}
        </View>
      ) : null}
      {banner ? <Text style={ui.banner}>{banner}</Text> : null}
    </ScrollView>
  );
}

function IdeaCard({
  item,
  names,
  onAdd,
}: {
  item: HabitSuggestion;
  names: readonly string[];
  onAdd: (item: HabitSuggestion) => void;
}) {
  const kept = suggestionsNotKept(names).every((idea) => idea.name !== item.name);
  return (
    <View style={ui.card} testID={`idea-${item.name.toLowerCase().replace(/\s+/g, "-")}`}>
      <Text style={ui.body}>{item.name}</Text>
      <Text style={ui.quiet}>
        {item.line} {kindLabel(item.entry)}.
      </Text>
      {kept ? (
        <Text style={ui.quiet}>On this month</Text>
      ) : (
        <Pressable
          style={ui.button}
          accessibilityLabel={`Add ${item.name}`}
          testID={`idea-add-${item.name.toLowerCase().replace(/\s+/g, "-")}`}
          onPress={() => onAdd(item)}
        >
          <Text style={ui.buttonText}>Add</Text>
        </Pressable>
      )}
    </View>
  );
}
