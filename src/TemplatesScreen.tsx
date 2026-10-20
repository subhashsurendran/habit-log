import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import {
  TEMPLATE_LIMIT,
  createHabitTemplate,
  deleteHabitTemplate,
  loadDashboard,
  openAppDatabase,
  startMonthFromTemplate,
  unsetMonthTemplate,
  updateHabitTemplate,
  type DashboardState,
  type TemplateDraft,
} from "./db";
import { errorText, logOpenFailed, OPEN_FAILED } from "./errors";
import { currentMonth, monthTitle, nextMonth } from "./month";
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
  templateId,
  onBegin,
  onEdit,
  onDone,
  onOpenToday,
  onGesture,
}: {
  editing: boolean;
  templateId: string | null;
  onBegin: () => void;
  onEdit: (templateId: string) => void;
  onDone: () => void;
  onOpenToday: () => void;
  onGesture: () => void;
}) {
  const [board, setBoard] = useState<DashboardState | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [banner, setBannerState] = useState<{ text: string; failed: boolean } | null>(null);
  function setBanner(text: string | null, failed = false) {
    setBannerState(text == null ? null : { text, failed });
  }
  const [name, setName] = useState("");
  const [rows, setRows] = useState<TemplateDraft[]>([]);
  const [habitName, setHabitName] = useState("");
  const [entry, setEntry] = useState<Entry>("tick");
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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

  useEffect(() => {
    if (!editing || !templateId || !board || loadedId === templateId) return;
    const template = board.templates.find((item) => item.id === templateId);
    if (!template) {
      setBanner("That list is not stored.", true);
      setLoadedId(templateId);
      return;
    }
    setName(template.name);
    setRows(template.habits.map((habit) => ({ name: habit.name, entry: habit.entry, tags: habit.tags })));
    setLoadedId(templateId);
  }, [board, editing, loadedId, templateId]);

  function addHabit() {
    onGesture();
    try {
      const nextName = validateName(habitName);
      const nextEntry = entryForName(nextName, entry);
      setRows((current) => [...current, { name: nextName, entry: nextEntry, tags: [] }]);
      setHabitName("");
      setBanner(null);
    } catch (error: unknown) {
      setBanner(errorText(error), true);
    }
  }

  function save() {
    onGesture();
    void openAppDatabase()
      .then((database) =>
        templateId
          ? updateHabitTemplate(database, templateId, name, rows)
          : createHabitTemplate(database, name, rows),
      )
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
      .catch((error: unknown) => setBanner(errorText(error), true));
  }

  function remove(templateIdToDelete: string) {
    onGesture();
    if (confirmDeleteId !== templateIdToDelete) {
      setConfirmDeleteId(templateIdToDelete);
      setBanner("Delete removes the list. A month already started stays.");
      return;
    }
    void openAppDatabase()
      .then((database) => deleteHabitTemplate(database, templateIdToDelete))
      .then(() => reload())
      .then((next) => {
        setBoard(next);
        setConfirmDeleteId(null);
        setBanner("Deleted.");
      })
      .catch((error: unknown) => setBanner(errorText(error), true));
  }

  function start(templateId: string) {
    onGesture();
    const marked = (board?.current.records.length ?? 0) > 0;
    const target = marked ? nextMonth() : currentMonth();
    const title = monthTitle(target.year, target.month);
    void openAppDatabase()
      .then((database) => startMonthFromTemplate(database, templateId))
      .then((ready) => reload().then((next) => ({ next, ready })))
      .then(({ next, ready }) => {
        setBoard(next);
        setBanner(
          ready.already
            ? `${ready.title} is already set.`
            : ready.title === title && marked
              ? `${ready.title} is ready. This month is unchanged.`
              : `${ready.title} is ready.`,
        );
      })
      .catch((error: unknown) => setBanner(errorText(error), true));
  }

  function unset(templateId: string) {
    onGesture();
    void openAppDatabase()
      .then((database) => unsetMonthTemplate(database, templateId))
      .then((ready) => reload().then((next) => ({ next, ready })))
      .then(({ next, ready }) => {
        setBoard(next);
        setBanner(`${ready} is unset.`);
      })
      .catch((error: unknown) => setBanner(errorText(error), true));
  }

  const markedMonth = (board?.current.records.length ?? 0) > 0;
  const targetMonth = markedMonth ? nextMonth() : currentMonth();
  const targetTitle = monthTitle(targetMonth.year, targetMonth.month);

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
      ) : board && board.templates.length >= TEMPLATE_LIMIT ? (
        <Text style={ui.quiet} testID="template-limit">
          Three templates is the limit.
        </Text>
      ) : (
        <Pressable
          style={ui.primary}
          testID="template-new"
          onPress={() => {
            onGesture();
            setBanner(null);
            setConfirmDeleteId(null);
            onBegin();
          }}
        >
          <Text style={ui.primaryText}>New template</Text>
        </Pressable>
      )}
      {!fatal && !board ? <Text style={ui.body}>Opening…</Text> : null}
      {board && board.templates.length === 0 ? <Text style={ui.quiet}>No templates yet.</Text> : null}
      {board?.templates.map((template) => {
        const setForMonth = board.preparedTemplateId === template.id;
        return (
          <View
            key={template.id}
            style={[ui.card, setForMonth && { borderColor: "#3DDC97" }]}
            testID={`template-${template.id}`}
          >
            <Text style={ui.body}>{template.name}</Text>
            {template.habits.map((habit, index) => (
              <Text key={`${habit.name}-${index}`} style={ui.quiet}>
                {habit.name} · {kindLabel(habit.entry)}
              </Text>
            ))}
            <Text style={ui.quiet}>{setForMonth ? `Set for ${targetTitle}` : `Not set for ${targetTitle}`}</Text>
            <View style={ui.row}>
              {setForMonth ? (
                <Pressable
                  style={ui.button}
                  accessibilityLabel="Unset"
                  testID={`template-unset-${template.id}`}
                  onPress={() => {
                    setConfirmDeleteId(null);
                    unset(template.id);
                  }}
                >
                  <Text style={ui.buttonText}>Unset</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={ui.button}
                  accessibilityLabel={`Set for ${targetTitle}`}
                  testID={`template-start-${template.id}`}
                  onPress={() => {
                    setConfirmDeleteId(null);
                    start(template.id);
                  }}
                >
                  <Text style={ui.buttonText}>Set</Text>
                </Pressable>
              )}
              <Pressable
                style={ui.button}
                accessibilityLabel={`Edit ${template.name}`}
                testID={`template-edit-${template.id}`}
                onPress={() => {
                  onGesture();
                  setConfirmDeleteId(null);
                  setBanner(null);
                  onEdit(template.id);
                }}
              >
                <Text style={ui.buttonText}>Edit</Text>
              </Pressable>
              <Pressable
                style={ui.button}
                accessibilityLabel={
                  confirmDeleteId === template.id ? `Confirm delete ${template.name}` : `Delete ${template.name}`
                }
                testID={`template-delete-${template.id}`}
                onPress={() => remove(template.id)}
              >
                <Text style={ui.buttonText}>{confirmDeleteId === template.id ? "Confirm delete" : "Delete"}</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
      {banner ? <Text style={banner.failed ? ui.banner : ui.note}>{banner.text}</Text> : null}
    </ScrollView>
  );
}
