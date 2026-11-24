import { Pressable, StyleSheet, Text, View } from "react-native";

import { ink, ui } from "./theme";

/** Sits in the layout, above the screen, so it does not cover the grid or the tab bar. */
export function ScreenNav({ onBack, onExit }: { onBack: () => void; onExit: () => void }) {
  return (
    <View style={styles.bar} testID="screen-nav">
      <Pressable style={ui.button} testID="back" onPress={onBack} accessibilityLabel="Back">
        <Text style={ui.buttonText}>Back</Text>
      </Pressable>
      <Pressable style={ui.button} testID="exit" onPress={onExit} accessibilityLabel="Exit">
        <Text style={ui.buttonText}>Exit</Text>
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
});
