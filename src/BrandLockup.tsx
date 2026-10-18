import { Image, StyleSheet, Text, View } from "react-native";

export const TAGLINE = "Building habits for the long term, one checks at a time.";

export function BrandLockup() {
  return (
    <View style={styles.row}>
      <Image
        source={require("../assets/mydtc-logo.png")}
        style={styles.logo}
        accessibilityLabel="MyDTC logo. A checklist being checked, then checks building into a habit."
        testID="mydtc-logo"
      />
      <View style={styles.copy}>
        <Text style={styles.title}>MyDTC</Text>
        <Text style={styles.tagline}>{TAGLINE}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  logo: { width: 72, height: 72, borderRadius: 16 },
  copy: { flex: 1 },
  title: { fontSize: 28, fontWeight: "800", color: "#102A43" },
  tagline: { marginTop: 2, color: "#0F6E56", fontSize: 14, lineHeight: 19, fontWeight: "600" },
});
