import { Pressable, StyleSheet, Text, View } from "react-native";

import { ink } from "./theme";

/** Sits in the layout, above the screen, so it does not cover the grid or the tab bar. */
export function ScreenNav({ onBack, onExit }: { onBack: () => void; onExit: () => void }) {
  return (
    <View style={styles.bar} testID="screen-nav">
      <Pressable style={styles.button} testID="back" onPress={onBack} accessibilityLabel="Back">
        <Text style={styles.label}>Back</Text>
      </Pressable>
      <Pressable style={styles.button} testID="exit" onPress={onExit} accessibilityLabel="Exit">
        <Text style={styles.label}>Exit</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: ink.ground,
  },
  button: {
    height: 36,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: ink.bezel,
    borderRadius: 10,
    backgroundColor: ink.card,
  },
  label: { color: ink.text, fontSize: 14, fontWeight: "700" },
});
