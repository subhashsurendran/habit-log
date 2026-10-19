import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import {
  createHabitTemplate,
  loadDashboard,
  openAppDatabase,
  startMonthFromTemplate,
  type DashboardState,
  type TemplateDraft,
} from "./db";
import { errorText, logOpenFailed, OPEN_FAILED } from "./errors";
import { entryForName, NAME_MAX, validateName } from "./names";
import { ui } from "./theme";
import type { Entry } from "./types";

const KINDS = ["tick", "timer", "journal", "checklist"] as const;

function kindLabel(entry: Entry): string {
  if (entry === "tick") return "Tick";
  if (entry === "timer") return "Timer";
  if (entry === "journal") return "Journal";
  return "Checklist";
}

export function TemplatesScreen({
  editing,
  onBegin,
  onDone,
  onOpenToday,
  onGesture,
}: {
  editing: boolean;
  onBegin: () => void;
  onDone: () => void;
  onOpenToday: () => void;
  onGesture: () => void;
}) {
  const [board, setBoard] = useState<DashboardState | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [rows, setRows] = useState<TemplateDraft[]>([]);
  const [habitName, setHabitName] = useState("");
  const [entry, setEntry] = useState<Entry>("tick");

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

  function addHabit() {
    onGesture();
    try {
      const nextName = validateName(habitName);
      const nextEntry = entryForName(nextName, entry);
      setRows((current) => [...current, { name: nextName, entry: nextEntry, tags: [] }]);
      setHabitName("");
      setBanner(null);
    } catch (error: unknown) {
      setBanner(errorText(error));
    }
  }

  function save() {
    onGesture();
    void openAppDatabase()
      .then((database) => createHabitTemplate(database, name, rows))
      .then(() => reload())
      .then((next) => {
        setBoard(next);
        setName("");
        setRows([]);
        setHabitName("");
        setEntry("tick");
        setBanner(null);
        onDone();
      })
      .catch((error: unknown) => setBanner(errorText(error)));
  }

  function start(templateId: string) {
    onGesture();
    void openAppDatabase()
      .then((database) => startMonthFromTemplate(database, templateId))
      .then(() => onOpenToday())
      .catch((error: unknown) => setBanner(errorText(error)));
  }

  return (
    <ScrollView
      style={ui.screen}
      contentContainerStyle={ui.page}
      keyboardShouldPersistTaps="handled"
      testID="templates-screen"
    >
      <Text style={ui.title} accessibilityRole="header">
        Templates
      </Text>
      {fatal ? <Text style={ui.body}>{fatal}</Text> : null}
      {editing ? (
        <View style={ui.stack} testID="template-editor">
          <TextInput
            testID="template-name"
            value={name}
            onChangeText={(value) => {
              setName(value);
              setBanner(null);
            }}
            onFocus={onGesture}
            placeholder="Template name"
            placeholderTextColor="#8A7A9E"
            maxLength={NAME_MAX}
            autoCorrect={false}
            style={ui.input}
          />
          {rows.map((row, index) => (
            <View key={`${row.name}-${index}`} style={ui.row}>
              <Text style={ui.body}>
                {row.name} · {kindLabel(row.entry)}
              </Text>
              <Pressable
                testID={`template-draft-remove-${index}`}
                onPress={() => setRows((current) => current.filter((_, item) => item !== index))}
              >
                <Text style={ui.quiet}>Remove</Text>
              </Pressable>
            </View>
          ))}
          <TextInput
            testID="template-habit-name"
            value={habitName}
            onChangeText={setHabitName}
            onFocus={onGesture}
            placeholder="Habit name"
            placeholderTextColor="#8A7A9E"
            maxLength={NAME_MAX}
            autoCorrect={false}
            style={ui.input}
          />
          <View style={ui.row}>
            {KINDS.map((kind) => (
              <Pressable
                key={kind}
                testID={`template-kind-${kind}`}
                style={[ui.button, entry === kind && { borderColor: "#3DDC97" }]}
                onPress={() => {
                  onGesture();
                  setEntry(kind);
                }}
              >
                <Text style={ui.buttonText}>{kindLabel(kind)}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={ui.button} testID="template-add-habit" onPress={addHabit}>
            <Text style={ui.buttonText}>Add habit</Text>
          </Pressable>
          <Pressable style={ui.primary} testID="template-save" onPress={save}>
            <Text style={ui.primaryText}>Save</Text>
          </Pressable>
          <Pressable
            style={ui.button}
            testID="template-cancel"
            onPress={() => {
              onGesture();
              setBanner(null);
              onDone();
            }}
          >
            <Text style={ui.buttonText}>Cancel</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          style={ui.primary}
          testID="template-new"
          onPress={() => {
            onGesture();
            setBanner(null);
            onBegin();
          }}
        >
          <Text style={ui.primaryText}>New template</Text>
        </Pressable>
      )}
      {!fatal && !board ? <Text style={ui.body}>Opening…</Text> : null}
      {board && board.templates.length === 0 ? <Text style={ui.quiet}>No templates yet.</Text> : null}
      {board?.templates.map((template) => (
        <View key={template.id} style={ui.card} testID={`template-${template.id}`}>
          <Text style={ui.body}>{template.name}</Text>
          {template.habits.map((habit, index) => (
            <Text key={`${habit.name}-${index}`} style={ui.quiet}>
              {habit.name} · {kindLabel(habit.entry)}
            </Text>
          ))}
          <Pressable style={ui.button} testID={`template-start-${template.id}`} onPress={() => start(template.id)}>
            <Text style={ui.buttonText}>Start this month</Text>
          </Pressable>
        </View>
      ))}
      {banner ? <Text style={ui.banner}>{banner}</Text> : null}
    </ScrollView>
  );
}
