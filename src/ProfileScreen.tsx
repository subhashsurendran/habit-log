import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput } from "react-native";

import { DISPLAY_NAME_KEY, SOUND_MUTED_KEY, openAppDatabase, writeSetting } from "./db";
import { errorText } from "./errors";
import { validateCallName } from "./names";
import { ui } from "./theme";

export function ProfileScreen({
  name,
  muted,
  onName,
  onMuted,
  onGesture,
  onStart,
  onStop,
}: {
  name: string | null;
  muted: boolean;
  onName: (name: string) => void;
  onMuted: (muted: boolean) => void;
  onGesture: () => void;
  onStart: () => void;
  onStop: () => void;
}) {
  const [draft, setDraft] = useState(name ?? "");
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    setDraft(name ?? "");
  }, [name]);

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
        setBanner(null);
      })
      .catch((error: unknown) => setBanner(errorText(error)));
  }

  function toggleSound() {
    const next = !muted;
    onMuted(next);
    if (next) onStop();
    else onStart();
    void openAppDatabase()
      .then((database) => writeSetting(database, SOUND_MUTED_KEY, next ? "1" : "0"))
      .catch((error: unknown) => {
        onMuted(!next);
        if (next) onStart();
        else onStop();
        setBanner(errorText(error));
      });
  }

  return (
    <ScrollView
      style={ui.screen}
      contentContainerStyle={ui.page}
      keyboardShouldPersistTaps="handled"
      testID="profile-screen"
    >
      <Text style={ui.title} accessibilityRole="header">
        Profile
      </Text>
      <Text style={ui.section}>Name</Text>
      <TextInput
        testID="profile-name"
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
      <Pressable style={ui.button} testID="profile-save" onPress={saveName}>
        <Text style={ui.buttonText}>Save</Text>
      </Pressable>
      <Pressable
        style={ui.button}
        testID="sound"
        onPress={toggleSound}
        accessibilityLabel={muted ? "Sound off" : "Sound on"}
      >
        <Text style={ui.buttonText}>{muted ? "Sound off" : "Sound on"}</Text>
      </Pressable>
      {banner ? <Text style={ui.banner}>{banner}</Text> : null}
    </ScrollView>
  );
}
