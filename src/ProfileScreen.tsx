import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { DISPLAY_NAME_KEY, SOUND_MUTED_KEY, openAppDatabase, writeSetting } from "./db";
import { errorText } from "./errors";
import { sendSupportNote } from "./feedback";
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
  const [banner, setBannerState] = useState<{ text: string; failed: boolean } | null>(null);
  function setBanner(text: string | null, failed = false) {
    setBannerState(text == null ? null : { text, failed });
  }

  useEffect(() => {
    setDraft(name ?? "");
  }, [name]);

  function saveName() {
    onGesture();
    let next: string;
    try {
      next = validateCallName(draft);
    } catch (error: unknown) {
      setBanner(errorText(error), true);
      return;
    }
    void openAppDatabase()
      .then((database) => writeSetting(database, DISPLAY_NAME_KEY, next))
      .then(() => {
        onName(next);
        setBanner(null);
      })
      .catch((error: unknown) => setBanner(errorText(error), true));
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
        setBanner(errorText(error), true);
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
        {name ?? "Profile"}
      </Text>
      <WriteToUs onGesture={onGesture} />
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
      {banner ? (
        <Text style={banner.failed ? ui.banner : ui.note} testID="profile-line">
          {banner.text}
        </Text>
      ) : null}
      <Pressable
        style={ui.button}
        testID="sound"
        onPress={toggleSound}
        accessibilityLabel={muted ? "Sound off" : "Sound on"}
      >
        <Text style={ui.buttonText}>{muted ? "Sound off" : "Sound on"}</Text>
      </Pressable>
    </ScrollView>
  );
}

function WriteToUs({ onGesture }: { onGesture: () => void }) {
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [line, setLine] = useState<{ text: string; failed: boolean } | null>(null);

  function send() {
    onGesture();
    if (!note.trim() || sending) {
      if (!note.trim()) setLine({ text: "Write a note before sending.", failed: true });
      return;
    }
    setSending(true);
    setLine(null);
    void sendSupportNote(note)
      .then(() => {
        setNote("");
        setLine({ text: "Sent.", failed: false });
      })
      .catch((error: unknown) => setLine({ text: errorText(error), failed: true }))
      .finally(() => setSending(false));
  }

  return (
    <View style={ui.card} testID="write-to-us">
      <Text style={ui.section}>Write to us</Text>
      <Text style={ui.body}>A note or an idea. It goes to support@mydtc-app.com. The habit log stays on this phone.</Text>
      <TextInput
        testID="write-to-us-note"
        value={note}
        onChangeText={(value) => {
          setNote(value);
          setLine(null);
        }}
        onFocus={onGesture}
        placeholder="Note"
        placeholderTextColor="#8A7A9E"
        maxLength={2000}
        multiline
        editable={!sending}
        style={ui.noteBox}
      />
      <Pressable
        style={ui.primary}
        testID="write-to-us-send"
        accessibilityLabel="Send"
        disabled={sending}
        onPress={send}
      >
        <Text style={ui.primaryText}>{sending ? "Sending…" : "Send"}</Text>
      </Pressable>
      {line ? (
        <Text style={line.failed ? ui.banner : ui.note} testID="write-to-us-line">
          {line.text}
        </Text>
      ) : null}
    </View>
  );
}
