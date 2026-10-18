import { StyleSheet, Text, View } from "react-native";

export const TAGLINE = "Small checks. Lasting habits.";

export function BrandLockup() {
  return (
    <View style={styles.block} testID="mydtc-brand">
      <View
        style={styles.logoBezel}
        accessibilityLabel="MyDTC logo. A checklist being checked, then checks building into a habit."
        testID="mydtc-logo"
      >
        <View style={styles.card}>
          <CheckRow done />
          <CheckRow done />
          <CheckRow done={false} />
        </View>
        <View style={styles.climb}>
          <Text style={[styles.climbMark, styles.climbLow]}>✓</Text>
          <Text style={[styles.climbMark, styles.climbMid]}>✓</Text>
          <Text style={[styles.climbMark, styles.climbHigh]}>✓</Text>
        </View>
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

function CheckRow({ done }: { done: boolean }) {
  return (
    <View style={styles.cardRow}>
      <View style={[styles.box, done ? styles.boxDone : styles.boxOpen]}>
        {done ? <Text style={styles.boxTick}>✓</Text> : null}
      </View>
      <View style={styles.line} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { alignItems: "center", paddingTop: 8, paddingBottom: 4 },
  logoBezel: {
    width: 88,
    height: 88,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#CDB6FF",
    backgroundColor: "#2A2340",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  card: {
    width: 42,
    height: 62,
    borderRadius: 8,
    backgroundColor: "#F4ECFF",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 5,
  },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  box: { width: 12, height: 12, borderRadius: 3, alignItems: "center", justifyContent: "center" },
  boxDone: { backgroundColor: "#3DDC97" },
  boxOpen: { borderWidth: 1.5, borderColor: "#6E5A8A", backgroundColor: "#E7DCF8" },
  boxTick: { color: "#102A43", fontSize: 9, fontWeight: "800", lineHeight: 11 },
  line: { flex: 1, height: 2, borderRadius: 1, backgroundColor: "#CDB6FF" },
  climb: { height: 62, justifyContent: "flex-end", alignItems: "flex-end" },
  climbMark: { fontWeight: "800", lineHeight: 16 },
  climbLow: { color: "#6E5A8A", fontSize: 12 },
  climbMid: { color: "#CDB6FF", fontSize: 16 },
  climbHigh: { color: "#3DDC97", fontSize: 20 },
  wordmark: { marginTop: 16, fontSize: 40, fontWeight: "800", letterSpacing: -0.6 },
  my: { color: "#3DDC97" },
  dtc: {
    color: "#D4C6F5",
    textShadowColor: "rgba(205, 182, 255, 0.35)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
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
