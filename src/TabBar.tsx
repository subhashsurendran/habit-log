import { Pressable, StyleSheet, Text, View } from "react-native";

import { ink } from "./theme";

export type TabId = "home" | "today" | "score" | "templates" | "profile";

const TABS: { id: TabId; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "today", label: "Today" },
  { id: "score", label: "Score" },
  { id: "templates", label: "Templates" },
  { id: "profile", label: "Profile" },
];

export function TabBar({
  tab,
  onChange,
  onGesture,
}: {
  tab: TabId;
  onChange: (tab: TabId) => void;
  onGesture: () => void;
}) {
  return (
    <View style={styles.bar} testID="tab-bar">
      {TABS.map((item) => {
        const selected = item.id === tab;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected }}
            testID={`tab-${item.id}`}
            style={styles.tab}
            onPress={() => {
              onGesture();
              onChange(item.id);
            }}
          >
            <Text numberOfLines={1} style={[styles.label, selected && styles.labelOn]}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: ink.bezel,
    backgroundColor: ink.card,
    paddingTop: 8,
    paddingBottom: 8,
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 44 },
  label: { color: ink.quiet, fontSize: 12, fontWeight: "600" },
  labelOn: { color: ink.green },
});
