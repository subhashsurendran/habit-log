import { useEffect, useRef, useState, type ComponentType, type Ref } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import WebView from "react-native-webview";

// The package's iOS and Android prop types intersect to never under this SDK.
const SupportView = WebView as unknown as ComponentType<{
  ref?: Ref<WebView>;
  style?: { height: number; width: number; opacity: number };
  originWhitelist?: string[];
  source?: { html: string; baseUrl: string };
  injectedJavaScript?: string;
  onLoadEnd?: () => void;
  onMessage?: (event: { nativeEvent: { data: string } }) => void;
  onError?: () => void;
  onHttpError?: () => void;
  onShouldStartLoadWithRequest?: (request: { url: string }) => boolean;
}>;

import { DISPLAY_NAME_KEY, PROFILE_AGE_KEY, PROFILE_SEX_KEY, SOUND_MUTED_KEY, clearSetting, openAppDatabase, writeSetting } from "./db";
import { errorText } from "./errors";
import { validateAgeDraft, type Sex } from "./person";
import {
  ACTIVATE_LINE,
  NOT_SENT,
  READ_SUPPORT_PAGE,
  appBuild,
  cleanSupportNote,
  supportFormHtml,
  supportPageResult,
} from "./feedback";
import { validateCallName } from "./names";
import { ui } from "./theme";

export function ProfileScreen({
  name,
  age,
  sex,
  muted,
  onFacts,
  onMuted,
  onGesture,
  onStart,
  onStop,
}: {
  name: string | null;
  age: number | null;
  sex: Sex | null;
  muted: boolean;
  onFacts: (facts: { name: string; age: number | null; sex: Sex | null }) => void;
  onMuted: (muted: boolean) => void;
  onGesture: () => void;
  onStart: () => void;
  onStop: () => void;
}) {
  const [draft, setDraft] = useState(name ?? "");
  const [ageDraft, setAgeDraft] = useState(age == null ? "" : String(age));
  const [sexDraft, setSexDraft] = useState<Sex | null>(sex);
  const [banner, setBannerState] = useState<{ text: string; failed: boolean } | null>(null);
  function setBanner(text: string | null, failed = false) {
    setBannerState(text == null ? null : { text, failed });
  }

  useEffect(() => {
    setDraft(name ?? "");
    setAgeDraft(age == null ? "" : String(age));
    setSexDraft(sex);
  }, [name, age, sex]);

  function saveName() {
    onGesture();
    let nextName: string;
    let nextAge: number | null;
    try {
      nextName = validateCallName(draft);
      nextAge = validateAgeDraft(ageDraft);
    } catch (error: unknown) {
      setBanner(errorText(error), true);
      return;
    }
    const nextSex = sexDraft;
    void openAppDatabase()
      .then(async (database) => {
        await writeSetting(database, DISPLAY_NAME_KEY, nextName);
        if (nextAge == null) await clearSetting(database, PROFILE_AGE_KEY);
        else await writeSetting(database, PROFILE_AGE_KEY, String(nextAge));
        if (nextSex == null) await clearSetting(database, PROFILE_SEX_KEY);
        else await writeSetting(database, PROFILE_SEX_KEY, nextSex);
      })
      .then(() => {
        onFacts({ name: nextName, age: nextAge, sex: nextSex });
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
      <Text style={ui.section}>Age</Text>
      <TextInput
        testID="profile-age"
        value={ageDraft}
        onChangeText={(value) => {
          setAgeDraft(value);
          setBanner(null);
        }}
        onFocus={onGesture}
        onSubmitEditing={saveName}
        placeholder="Age"
        placeholderTextColor="#8A7A9E"
        maxLength={3}
        keyboardType="number-pad"
        inputMode="numeric"
        style={ui.input}
      />
      <Text style={ui.section}>Sex</Text>
      <View style={ui.row}>
        <SexChip
          label="Not set"
          testID="profile-sex-blank"
          selected={sexDraft == null}
          onPress={() => {
            onGesture();
            setSexDraft(null);
            setBanner(null);
          }}
        />
        <SexChip
          label="Female"
          testID="profile-sex-female"
          selected={sexDraft === "female"}
          onPress={() => {
            onGesture();
            setSexDraft("female");
            setBanner(null);
          }}
        />
        <SexChip
          label="Male"
          testID="profile-sex-male"
          selected={sexDraft === "male"}
          onPress={() => {
            onGesture();
            setSexDraft("male");
            setBanner(null);
          }}
        />
      </View>
      <Text style={ui.quiet}>Age and sex stay on this phone. Leave either blank. Not medical advice.</Text>
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

function SexChip({
  label,
  testID,
  selected,
  onPress,
}: {
  label: string;
  testID: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={selected ? ui.chipOn : ui.chip}
      testID={testID}
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
    >
      <Text style={selected ? ui.chipOnText : ui.chipText}>{label}</Text>
    </Pressable>
  );
}

function hostAllowed(url: string): boolean {
  if (url.startsWith("about:")) return true;
  try {
    const host = new URL(url).hostname;
    return host === "formsubmit.co" || host.endsWith(".formsubmit.co") || host === "challenges.cloudflare.com";
  } catch {
    return false;
  }
}

function WriteToUs({ onGesture }: { onGesture: () => void }) {
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [page, setPage] = useState<string | null>(null);
  const [line, setLine] = useState<{ text: string; failed: boolean } | null>(null);
  const view = useRef<WebView>(null);
  const finished = useRef(false);

  useEffect(() => {
    if (!sending) return;
    const timer = setTimeout(() => finish(NOT_SENT, true, false), 25000);
    return () => clearTimeout(timer);
  }, [sending]);

  function finish(text: string, failed: boolean, clear: boolean) {
    if (finished.current) return;
    finished.current = true;
    setSending(false);
    setPage(null);
    setLine({ text, failed });
    if (clear) setNote("");
  }

  function readPage(text: string) {
    const result = supportPageResult(text);
    if (result === "wait") return;
    if (result === "activate") finish(ACTIVATE_LINE, true, false);
    else if (result === "sent") finish("Sent.", false, true);
    else finish(NOT_SENT, true, false);
  }

  function send() {
    onGesture();
    if (sending) return;
    let next: string | null;
    try {
      next = cleanSupportNote(note);
    } catch (error: unknown) {
      setLine({ text: errorText(error), failed: true });
      return;
    }
    if (!next) {
      setLine({ text: "Write a note before sending.", failed: true });
      return;
    }
    if (Platform.OS !== "ios") {
      setLine({ text: NOT_SENT, failed: true });
      return;
    }
    finished.current = false;
    setLine(null);
    setPage(supportFormHtml(next, appBuild()));
    setSending(true);
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
      {page ? (
        <SupportView
          ref={view}
          style={{ height: 1, width: 1, opacity: 0 }}
          originWhitelist={["https://*", "about:*"]}
          source={{ html: page, baseUrl: "https://formsubmit.co/" }}
          injectedJavaScript={READ_SUPPORT_PAGE}
          onLoadEnd={() => view.current?.injectJavaScript(READ_SUPPORT_PAGE)}
          onMessage={(event) => readPage(event.nativeEvent.data)}
          onError={() => finish(NOT_SENT, true, false)}
          onHttpError={() => finish(NOT_SENT, true, false)}
          onShouldStartLoadWithRequest={(request) => hostAllowed(request.url)}
        />
      ) : null}
    </View>
  );
}
