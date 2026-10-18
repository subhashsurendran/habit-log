import { StatusBar } from "expo-status-bar";
import { Component, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { BrandLockup } from "./src/BrandLockup";
import { MonthScreen } from "./src/MonthScreen";

type BoundaryState = { message: string | null };

class ScreenBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { message: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    const message = error instanceof Error ? error.message : "";
    if (!message || message.length > 160 || message.includes("/")) {
      return { message: "The grid could not be drawn." };
    }
    return { message };
  }

  render(): ReactNode {
    if (this.state.message) {
      return (
        <View style={styles.fallback}>
          <BrandLockup />
          <Text style={styles.body}>{this.state.message}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScreenBoundary>
        <MonthScreen />
      </ScreenBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#16121C",
  },
  fallback: {
    flex: 1,
    backgroundColor: "#16121C",
    padding: 24,
    justifyContent: "center",
  },
  body: {
    marginTop: 12,
    fontSize: 16,
    color: "#E7DCF8",
  },
});
