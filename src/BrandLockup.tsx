import { Image, StyleSheet, Text, View } from "react-native";

export const TAGLINE = "Small checks. Lasting habits.";

export function BrandLockup() {
  return (
    <View style={styles.block} testID="mydtc-brand">
      <View style={styles.logoBezel}>
        <Image
          source={require("../assets/mydtc-logo.png")}
          style={styles.logo}
          accessibilityLabel="MyDTC logo. A checklist being checked, then checks building into a habit."
          testID="mydtc-logo"
        />
      </View>
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
  );
}

const styles = StyleSheet.create({
  block: { alignItems: "center", paddingTop: 8, paddingBottom: 4 },
  logoBezel: {
    padding: 3,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#F6EEFF",
    backgroundColor: "#D8C4FF",
  },
  logo: { width: 88, height: 88, borderRadius: 18 },
  wordmark: { marginTop: 16, fontSize: 40, fontWeight: "800", letterSpacing: -0.6 },
  my: { color: "#3DDC97" },
  dtc: {
    color: "#FFE56A",
    textShadowColor: "rgba(255, 248, 210, 0.95)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  tagline: {
    marginTop: 8,
    color: "#E7DCF8",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "500",
    letterSpacing: 0.3,
    textAlign: "center",
  },
});
