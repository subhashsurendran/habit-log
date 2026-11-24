import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { addHabit, openAppDatabase, openMonth } from "./db";
import { errorText, logOpenFailed, OPEN_FAILED } from "./errors";
import { EARLIER_DAYS_NOTE, earlierDaysCountAsNotDone } from "./month";
import { entryForName, isReservedTimeName, NAME_MAX, validateName } from "./names";
import { suggestionsNotKept } from "./suggestions";
import { ADD_PRESETS, nextTags, TAG_LIMIT_NOTE, TAG_MAX } from "./tags";
import { ui } from "./theme";
import type { Entry, MonthState } from "./types";

const KINDS = ["tick", "timer", "journal", "checklist"] as const;

function kindLabel(entry: Entry): string {
  if (entry === "tick") return "Tick";
  if (entry === "timer") return "Timer";
  if (entry === "journal") return "Journal";
  return "Checklist";
}

export function AddHabitScreen({
  monthId,
  onDone,
  onGesture,
}: {
  monthId: string;
  onDone: () => void;
  onGesture: () => void;
}) {
  const [month, setMonth] = useState<MonthState | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<Entry>("tick");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [banner, setBannerState] = useState<{ text: string; failed: boolean } | null>(null);
  const saving = useRef(false);

  function setBanner(text: string | null, failed = false) {
    setBannerState(text == null ? null : { text, failed });
  }

  useEffect(() => {
    let live = true;
    openAppDatabase()
      .then((database) => openMonth(database, monthId))
      .then((next) => {
        if (live) setMonth(next);
      })
      .catch(() => {
        if (!live) return;
        logOpenFailed();
        setFatal(OPEN_FAILED);
      });
    return () => {
      live = false;
    };
  }, [monthId]);

  const reserved = isReservedTimeName(name);
  const entry: Entry = reserved ? "timer" : chosen;
  const ideas = suggestionsNotKept(month?.habits.map((habit) => habit.name) ?? []).slice(0, 4);
  const midMonth = month
    ? earlierDaysCountAsNotDone(month.year, month.month, month.startedOn)
    : false;

  function commit() {
    onGesture();
    if (!month || saving.current) return;
    let habitName: string;
    try {
      habitName = validateName(name);
    } catch (error: unknown) {
      setBanner(errorText(error), true);
      return;
    }
    const nextEntry = entryForName(habitName, entry);
    if (midMonth && !accepted) {
      setAccepted(true);
      setBanner(null);
      return;
    }
    saving.current = true;
    void openAppDatabase()
      .then((database) => addHabit(database, month.id, habitName, nextEntry, tags))
      .then(() => onDone())
      .catch((error: unknown) => {
        saving.current = false;
        setBanner(errorText(error), true);
      });
  }

  return (
    <ScrollView
      style={ui.screen}
      contentContainerStyle={ui.page}
      keyboardShouldPersistTaps="handled"
      testID="add-habit-screen"
    >
      <View>
        <Text style={ui.title} accessibilityRole="header">
          Add habit
        </Text>
        <Text style={[ui.quiet, { marginTop: 4 }]} testID="add-habit-about">
          A row on this month. The type is a pill. Add habit puts it on the grid.
        </Text>
      </View>
      {fatal ? <Text style={ui.body}>{fatal}</Text> : null}
      {!fatal && !month ? <Text style={ui.body}>Opening…</Text> : null}
      {ideas.length ? (
        <View style={ui.stack}>
          <Text style={ui.section}>People keep these</Text>
          <View style={ui.row}>
            {ideas.map((idea) => (
              <Pressable
                key={idea.name}
                testID={`suggest-${idea.name.toLowerCase().replace(/\s+/g, "-")}`}
                style={ui.button}
                onPress={() => {
                  onGesture();
                  setName(idea.name);
                  setChosen(idea.entry);
                  setBanner(null);
                }}
              >
                <Text style={ui.buttonText}>{idea.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      <View style={ui.row}>
        {ADD_PRESETS.map((preset) => (
          <Pressable
            key={preset.name}
            testID={`preset-${preset.name.toLowerCase()}`}
            style={ui.button}
            onPress={() => {
              onGesture();
              setChosen("tick");
              setTags((current) => {
                const withoutPreset = current.filter(
                  (tag) => !ADD_PRESETS.some((item) => item.tag.toLowerCase() === tag.toLowerCase()),
                );
                const next = nextTags(withoutPreset, preset.tag);
                setBanner(next.refused ? TAG_LIMIT_NOTE : null, next.refused);
                return next.tags;
              });
            }}
          >
            <Text style={ui.buttonText}>
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
          setBanner(null);
        }}
        onFocus={onGesture}
        placeholder="Habit name"
        placeholderTextColor="#8A7A9E"
        maxLength={NAME_MAX}
        autoCorrect={false}
        style={ui.input}
      />
      <View style={ui.stack}>
        <Text style={ui.section}>Habit type</Text>
        <View style={ui.row}>
          {KINDS.map((kind) => (
            <Pressable
              key={kind}
              testID={`add-kind-${kind}`}
              accessibilityLabel={kindLabel(kind)}
              disabled={reserved && kind !== "timer"}
              style={[ui.chip, entry === kind && ui.chipOn]}
              onPress={() => {
                onGesture();
                setChosen(kind);
              }}
            >
              <Text style={entry === kind ? ui.chipOnText : ui.chipText}>{kindLabel(kind)}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={ui.quiet}>
          {entry === "checklist"
            ? "Subtasks sit under this row."
            : reserved
              ? "Wake up and Sleep Time are timers."
              : "The name stays what you type."}
        </Text>
      </View>
      <View style={ui.stack}>
        <Text style={ui.section}>Tags</Text>
        <View style={ui.row}>
          {tags.map((tag) => (
            <Pressable
              key={tag}
              style={ui.button}
              onPress={() => {
                onGesture();
                setTags(tags.filter((item) => item !== tag));
              }}
            >
              <Text style={ui.buttonText}>{tag}  x</Text>
            </Pressable>
          ))}
          {tags.length ? null : <Text style={ui.quiet}>None yet</Text>}
        </View>
        <View style={ui.row}>
          <TextInput
            testID="tag-draft"
            value={tagDraft}
            onChangeText={setTagDraft}
            onFocus={onGesture}
            placeholder="Add a tag"
            placeholderTextColor="#8A7A9E"
            maxLength={TAG_MAX}
            autoCorrect={false}
            style={[ui.input, { flex: 1 }]}
          />
          <Pressable
            style={ui.button}
            testID="add-tag"
            onPress={() => {
              onGesture();
              const next = nextTags(tags, tagDraft);
              setTags(next.tags);
              setBanner(next.refused ? TAG_LIMIT_NOTE : null, next.refused);
              if (!next.refused) setTagDraft("");
            }}
          >
            <Text style={ui.buttonText}>Add tag</Text>
          </Pressable>
        </View>
      </View>
      {midMonth && accepted ? (
        <Text style={ui.note} testID="earlier-days-note">
          {EARLIER_DAYS_NOTE}
        </Text>
      ) : null}
      <Pressable style={ui.addHabit} testID="add-save" onPress={commit}>
        <Text style={ui.addHabitText}>Add habit</Text>
      </Pressable>
      <Pressable
        style={ui.button}
        testID="add-cancel"
        onPress={() => {
          onGesture();
          onDone();
        }}
      >
        <Text style={ui.buttonText}>Cancel</Text>
      </Pressable>
      {banner ? (
        <Text style={banner.failed ? ui.banner : ui.note} testID={banner.text === TAG_LIMIT_NOTE ? "tag-limit-note" : "add-habit-line"}>
          {banner.text}
        </Text>
      ) : null}
    </ScrollView>
  );
}
