import { Image, StyleSheet, Text, View } from "react-native";

export const TAGLINE = "Small checks. Lasting habits.";

export function BrandLockup() {
  return (
    <View style={styles.row}>
      <View style={styles.logoBezel}>
        <Image
          source={require("../assets/mydtc-logo.png")}
          style={styles.logo}
          accessibilityLabel="MyDTC logo. A checklist being checked, then checks building into a habit."
          testID="mydtc-logo"
        />
      </View>
      <View style={styles.copy}>
        <Text style={styles.wordmark} testID="mydtc-wordmark">
          <Text style={styles.my} testID="mydtc-my">
            My
          </Text>
          <Text style={styles.dtc} testID="mydtc-dtc">
            DTC
          </Text>
        </Text>
        <Text style={styles.tagline}>{TAGLINE}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  logoBezel: {
    padding: 2,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#F6EEFF",
    backgroundColor: "#D8C4FF",
  },
  logo: { width: 68, height: 68, borderRadius: 15 },
  copy: { flex: 1 },
  wordmark: { fontSize: 28, fontWeight: "800", letterSpacing: -0.4 },
  my: { color: "#3DDC97" },
  dtc: {
    color: "#FFE56A",
    textShadowColor: "rgba(255, 248, 210, 0.95)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  tagline: {
    marginTop: 4,
    color: "#E7DCF8",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
    letterSpacing: 0.2,
  },
});
