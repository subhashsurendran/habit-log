import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { addHabit, loadDashboard, openAppDatabase, type DashboardState } from "./db";
import { errorText, logOpenFailed, OPEN_FAILED } from "./errors";
import { EARLIER_DAYS_NOTE, earlierDaysCountAsNotDone } from "./month";
import type { Person } from "./person";
import { alreadyKept, ideasFor, suggestionAt, suggestionsNotKept, type HabitSuggestion } from "./suggestions";
import { ui } from "./theme";
import type { Entry } from "./types";

function kindLabel(entry: Entry): string {
  if (entry === "tick") return "Tick";
  if (entry === "timer") return "Timer";
  if (entry === "journal") return "Journal";
  return "Checklist";
}

export function IdeasScreen({ person, onGesture }: { person: Person; onGesture: () => void }) {
  const [board, setBoard] = useState<DashboardState | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [banner, setBannerState] = useState<{ text: string; failed: boolean } | null>(null);
  const [acceptedName, setAcceptedName] = useState<string | null>(null);
  const saving = useRef(false);
  function setBanner(text: string | null, failed = false) {
    setBannerState(text == null ? null : { text, failed });
  }

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
    if (!board || saving.current) return;
    onGesture();
    const midMonth = earlierDaysCountAsNotDone(
      board.current.year,
      board.current.month,
      board.current.startedOn,
    );
    if (midMonth && acceptedName !== item.name) {
      setAcceptedName(item.name);
      return;
    }
    saving.current = true;
    void openAppDatabase()
      .then((database) => addHabit(database, board.current.id, item.name, item.entry, []))
      .then(() => reload())
      .then((next) => {
        setAcceptedName(null);
        setBoard(next);
        setBanner(`${item.name} is on this month.`);
      })
      .catch((error: unknown) => setBanner(errorText(error), true))
      .finally(() => {
        saving.current = false;
      });
  }

  const names = board?.current.habits.map((habit) => habit.name) ?? [];
  const ideas = ideasFor(person);
  const gist = suggestionAt(ideas, 0);
  const rest = ideas.filter((item) => item.name !== gist?.name);
  const waiting = suggestionsNotKept(names, ideas);

  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.page} testID="ideas-screen">
      <View>
        <Text style={ui.title} accessibilityRole="header">
          What's kept
        </Text>
        <Text style={[ui.quiet, { marginTop: 4 }]} testID="ideas-about">
          Picked from the name, age, and sex on this phone. A blank age or sex still gets a list. Not medical advice.
        </Text>
      </View>
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
          <IdeaCard item={gist} names={names} acceptedName={acceptedName} onAdd={add} live />
        </View>
      ) : null}
      {rest.length ? (
        <View style={ui.stack}>
          <Text style={ui.section}>Also kept</Text>
          {rest.map((item) => (
            <IdeaCard key={item.name} item={item} names={names} acceptedName={acceptedName} onAdd={add} />
          ))}
        </View>
      ) : null}
      {banner ? <Text style={banner.failed ? ui.banner : ui.note}>{banner.text}</Text> : null}
    </ScrollView>
  );
}

function IdeaCard({
  item,
  names,
  acceptedName,
  onAdd,
  live = false,
}: {
  item: HabitSuggestion;
  names: readonly string[];
  acceptedName: string | null;
  onAdd: (item: HabitSuggestion) => void;
  live?: boolean;
}) {
  const kept = alreadyKept(names, item.name);
  const slug = item.name.toLowerCase().replace(/\s+/g, "-");
  return (
    <View style={live ? ui.cardLive : ui.card} testID={`idea-${slug}`}>
      <Text style={ui.body}>{item.name}</Text>
      <Text style={ui.quiet}>
        {item.line} {kindLabel(item.entry)}.
      </Text>
      {kept ? (
        <Text style={ui.quiet}>On this month</Text>
      ) : (
        <>
          {acceptedName === item.name ? (
            <Text style={ui.note} testID={`idea-earlier-${slug}`}>
              {EARLIER_DAYS_NOTE}
            </Text>
          ) : null}
          <Pressable
            style={ui.button}
            accessibilityLabel={`Add ${item.name}`}
            testID={`idea-add-${slug}`}
            onPress={() => onAdd(item)}
          >
            <Text style={ui.buttonText}>Add</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
