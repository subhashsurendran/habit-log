import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { BrandLockup } from "./BrandLockup";
import {
  DISPLAY_NAME_KEY,
  loadDashboard,
  openAppDatabase,
  writeSetting,
  type DashboardState,
} from "./db";
import { errorText, logOpenFailed, OPEN_FAILED } from "./errors";
import { greetingLine } from "./greet";
import { validateCallName } from "./names";
import { scoreStoredMonth } from "./score";
import { ui } from "./theme";

export function HomeScreen({
  name,
  onName,
  onOpenToday,
  onAddHabit,
  onOpenProfile,
  onGesture,
}: {
  name: string | null;
  onName: (name: string) => void;
  onOpenToday: () => void;
  onAddHabit: () => void;
  onOpenProfile: () => void;
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

  const score = board ? scoreStoredMonth(board.current) : null;

  return (
    <ScrollView
      style={ui.screen}
      contentContainerStyle={ui.page}
      keyboardShouldPersistTaps="handled"
      testID="home-screen"
    >
      <View>
        <View style={ui.row}>
          <View style={{ flex: 1 }} />
          <Pressable
            style={ui.button}
            testID="profile"
            onPress={() => {
              onGesture();
              onOpenProfile();
            }}
          >
            <Text style={ui.buttonText}>Profile</Text>
          </Pressable>
        </View>
        <BrandLockup />
      </View>
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
      <Pressable
        style={ui.primary}
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
        testID="add-habit"
        onPress={() => {
          onGesture();
          onAddHabit();
        }}
      >
        <Text style={ui.buttonText}>Add habit</Text>
      </Pressable>
      {banner ? <Text style={ui.banner}>{banner}</Text> : null}
    </ScrollView>
  );
}
