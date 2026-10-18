import { useEffect, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { BrandLockup } from "./BrandLockup";
import {
  loadDashboard,
  openAppDatabase,
  saveHabitTemplate,
  startMonthFromTemplate,
  type DashboardState,
} from "./db";
import { errorText } from "./errors";
import { monthTitle } from "./month";
import { NAME_MAX } from "./names";
import { scoreMonth } from "./score";

export function DashboardScreen({ onOpenMonth }: { onOpenMonth: (monthId: string) => void }) {
  const [board, setBoard] = useState<DashboardState | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");

  async function reload() {
    const database = await openAppDatabase();
    setBoard(await loadDashboard(database));
    setFatal(null);
  }

  useEffect(() => {
    let live = true;
    reload().catch((error: unknown) => {
      console.error(error);
      if (!live) return;
      setFatal("Could not open the log on this device.");
    });
    return () => {
      live = false;
    };
  }, []);

  if (fatal) {
    return (
      <SafeAreaView style={styles.screen}>
        <BrandLockup />
        <Text style={styles.hint}>{fatal}</Text>
      </SafeAreaView>
    );
  }
  if (!board) {
    return (
      <SafeAreaView style={styles.screen}>
        <BrandLockup />
        <Text style={styles.hint}>Opening the month…</Text>
      </SafeAreaView>
    );
  }

  const today = new Date();
  const score = scoreMonth({
    year: board.current.year,
    month: board.current.month,
    today: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`,
    startedOn: board.current.startedOn,
    wrappedDates: board.current.wrappedDates,
    habits: board.current.habits,
    records: board.current.records,
  });

  return (
    <SafeAreaView style={styles.screen} testID="dashboard">
      <ScrollView contentContainerStyle={styles.body}>
        <BrandLockup />
        <View style={styles.card}>
          <Text style={styles.section}>This month</Text>
          {score.percent == null ? (
            <Text style={styles.empty} testID="dashboard-score">
              No closed days yet.
            </Text>
          ) : (
            <Text style={styles.percent} testID="dashboard-score">
              {score.percent}%
            </Text>
          )}
          {score.percent == null ? null : (
            <Text style={styles.hint}>
              Done {score.done} · Miss {score.miss}
            </Text>
          )}
          <Text style={styles.section}>Focus</Text>
          {score.focus.length ? (
            score.focus.map((item) => (
              <Text key={item.label} style={styles.hint}>
                {item.label} · {item.misses}
              </Text>
            ))
          ) : (
            <Text style={styles.hint}>None yet</Text>
          )}
          <Pressable
            style={[styles.button, styles.buttonOn]}
            testID="dashboard-this-month"
            onPress={() => onOpenMonth(board.current.id)}
          >
            <Text style={[styles.buttonText, styles.buttonOnText]}>This month</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>Past months</Text>
          {board.past.length ? (
            board.past.map((month) => (
              <Pressable
                key={month.id}
                style={styles.button}
                testID={`past-month-${month.id}`}
                onPress={() => onOpenMonth(month.id)}
              >
                <Text style={styles.buttonText}>{monthTitle(month.year, month.month)}</Text>
              </Pressable>
            ))
          ) : (
            <Text style={styles.hint}>No past months yet.</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>Templates</Text>
          <Text style={styles.hint}>Marks stay on the month.</Text>
          <TextInput
            testID="template-name"
            value={templateName}
            onChangeText={setTemplateName}
            placeholder="Template name"
            placeholderTextColor="#8A7A9E"
            maxLength={NAME_MAX}
            autoCorrect={false}
            style={styles.input}
          />
          <Pressable
            style={styles.button}
            testID="template-save"
            onPress={() => {
              void openAppDatabase()
                .then((database) => saveHabitTemplate(database, board.current.id, templateName))
                .then(() => reload())
                .then(() => {
                  setTemplateName("");
                  setBanner(null);
                })
                .catch((error: unknown) => setBanner(errorText(error)));
            }}
          >
            <Text style={styles.buttonText}>Save list</Text>
          </Pressable>
          {board.templates.map((template) => (
            <Pressable
              key={template.id}
              style={styles.button}
              testID={`template-start-${template.id}`}
              onPress={() => {
                void openAppDatabase()
                  .then((database) => startMonthFromTemplate(database, template.id))
                  .then(() => reload())
                  .then(() => setBanner(null))
                  .catch((error: unknown) => setBanner(errorText(error)));
              }}
            >
              <Text style={styles.buttonText}>Start month · {template.name}</Text>
            </Pressable>
          ))}
          {banner ? <Text style={styles.banner}>{banner}</Text> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#16121C" },
  body: { padding: 16, paddingBottom: 40, gap: 16 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#6E5A8A",
    borderRadius: 10,
    backgroundColor: "#1C1726",
    padding: 16,
  },
  section: { color: "#F6F1FF", fontSize: 16, fontWeight: "800", marginBottom: 8 },
  percent: { color: "#F6F1FF", fontSize: 40, fontWeight: "800" },
  empty: { color: "#E7DCF8", fontSize: 18, fontWeight: "700" },
  hint: { color: "#D9CCEA", fontSize: 14, lineHeight: 20, marginTop: 4 },
  banner: { color: "#FF8AA0", fontSize: 14, marginTop: 8 },
  button: {
    alignSelf: "flex-start",
    height: 36,
    justifyContent: "center",
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#3A3348",
    borderRadius: 10,
    paddingHorizontal: 14,
    backgroundColor: "#1C1726",
  },
  buttonOn: { backgroundColor: "#2A2340", borderColor: "#6E5A8A" },
  buttonText: { color: "#E7DCF8", fontSize: 14, fontWeight: "600" },
  buttonOnText: { color: "#F6F1FF" },
  input: {
    marginTop: 8,
    height: 36,
    borderWidth: 1,
    borderColor: "#3A3348",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#F6F1FF",
    backgroundColor: "#16121C",
    fontSize: 16,
  },
});
