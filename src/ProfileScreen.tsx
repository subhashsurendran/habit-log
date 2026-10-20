import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { DISPLAY_NAME_KEY, SOUND_MUTED_KEY, openAppDatabase, writeSetting } from "./db";
import { errorText } from "./errors";
import { validateCallName } from "./names";
import { buyPremiumYear, loadPremiumOffer, type PremiumOffer } from "./premium";
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
        {name ?? "Profile"}
      </Text>
      <PremiumCard onGesture={onGesture} />
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

function PremiumCard({ onGesture }: { onGesture: () => void }) {
  const [offer, setOffer] = useState<PremiumOffer | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void loadPremiumOffer().then((next) => {
      if (live) setOffer(next);
    });
    return () => {
      live = false;
    };
  }, []);

  function buy() {
    onGesture();
    if (!offer?.ready || offer.owned) return;
    void buyPremiumYear().then((paid) => {
      if (!paid) {
        setNote("The payment was not completed.");
        return;
      }
      setNote(null);
      setOffer({ ...offer, owned: true });
    });
  }

  const price = offer?.priceLabel ?? "₹499 a year";

  return (
    <View style={ui.card} testID="premium-card">
      <Text style={ui.section}>Premium</Text>
      <Text style={ui.percent} testID="premium-price">
        {price}
      </Text>
      <Text style={ui.body}>
        Today’s grid stays free. A year keeps older months and the later insights. Apple bills it.
      </Text>
      {offer?.owned ? (
        <Text style={ui.body} testID="premium-on">
          Premium is on.
        </Text>
      ) : null}
      {offer?.ready && !offer.owned ? (
        <>
          <Text style={ui.quiet}>
            The year renews until you cancel it in Settings, Apple ID, Subscriptions.
          </Text>
          <Pressable
            style={ui.primary}
            testID="premium-buy"
            accessibilityLabel="Continue with Apple"
            onPress={buy}
          >
            <Text style={ui.primaryText}>Continue with Apple</Text>
          </Pressable>
        </>
      ) : null}
      {offer && !offer.ready && !offer.owned ? (
        <Text style={ui.quiet} testID="premium-waiting">
          Not open for payment yet. It needs a paid Apple Developer membership and the product in App Store Connect.
        </Text>
      ) : null}
      {note ? <Text style={ui.banner}>{note}</Text> : null}
    </View>
  );
}
