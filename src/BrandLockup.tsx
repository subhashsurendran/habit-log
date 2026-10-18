import { Image, StyleSheet, Text, View } from "react-native";

export const TAGLINE = "Building long-term habits, one check at a time.";

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
        <View style={styles.rule} />
        <Text style={styles.tagline}>{TAGLINE}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  logo: { width: 72, height: 72, borderRadius: 16 },
  copy: { flex: 1 },
  title: { fontSize: 28, fontWeight: "800", color: "#102A43", letterSpacing: -0.4 },
  rule: { width: 36, height: 3, borderRadius: 2, backgroundColor: "#FF5A45", marginTop: 6 },
  tagline: {
    marginTop: 6,
    color: "#0F6E56",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
    letterSpacing: 0.15,
  },
});
