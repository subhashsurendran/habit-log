import { StatusBar } from "expo-status-bar";
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";

import { BrandLockup } from "./src/BrandLockup";
import { CalmLoop, type CalmLoopHandle } from "./src/calmLoop";
import { DISPLAY_NAME_KEY, EVENING_HOUR_KEY, EVENING_MINUTE_KEY, SOUND_MUTED_KEY, loadMonth, openAppDatabase, readSetting, writeSetting } from "./src/db";
import { logOpenFailed, OPEN_FAILED } from "./src/errors";
import { HomeScreen } from "./src/HomeScreen";
import { IdeasScreen } from "./src/IdeasScreen";
import { ProfileScreen } from "./src/ProfileScreen";
import { currentMonth, dateFor } from "./src/month";
import { MonthScreen } from "./src/MonthScreen";
import { callNameOrNull } from "./src/names";
import { syncDailyReminder, syncEveningWrap } from "./src/notify";
import { ScoreScreen } from "./src/ScoreScreen";
import { ScreenNav } from "./src/ScreenNav";
import { TabBar, type TabId } from "./src/TabBar";
import { TemplatesScreen } from "./src/TemplatesScreen";
import { ink } from "./src/theme";

type BoundaryState = { message: string | null };
type Prefs = { name: string | null; muted: boolean };
type Place =
  | { kind: "home" }
  | { kind: "today"; openAdd?: boolean }
  | { kind: "score"; monthId?: string }
  | { kind: "ideas" }
  | { kind: "templates" }
  | { kind: "template-editor"; templateId?: string }
  | { kind: "month"; monthId: string }
  | { kind: "profile" };

class ScreenBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { message: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    const message = error instanceof Error ? error.message : "";
    if (
      !message ||
      message.length > 160 ||
      message.includes("/") ||
      message.includes("\\") ||
      /sqlite|select |insert |update |delete |pragma|constraint|data:/i.test(message)
    ) {
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

function tabFor(place: Place): TabId {
  if (place.kind === "home") return "home";
  if (place.kind === "profile") return "profile";
  if (place.kind === "score") return "score";
  if (place.kind === "ideas") return "ideas";
  if (place.kind === "templates" || place.kind === "template-editor") return "templates";
  return "today";
}

function Shell() {
  const loop = useRef<CalmLoopHandle>(null);
  const mutedRef = useRef(true);
  const sheetBack = useRef<(() => boolean) | null>(null);
  const [stack, setStack] = useState<Place[]>([{ kind: "home" }]);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const place = stack[stack.length - 1] ?? { kind: "home" };

  useEffect(() => {
    let live = true;
    openAppDatabase()
      .then(async (database) => {
        const stored = await readSetting(database, DISPLAY_NAME_KEY);
        const flag = await readSetting(database, SOUND_MUTED_KEY);
        if (flag !== "1") await writeSetting(database, SOUND_MUTED_KEY, "1");
        const month = await loadMonth(database);
        if (!live) return;
        setPrefs({ name: callNameOrNull(stored), muted: true });
        try {
          const now = new Date();
          const today = dateFor(now.getFullYear(), now.getMonth() + 1, now.getDate());
          const todayWrapped = month.wrappedDates.includes(today);
          for (const habit of month.habits) {
            if (habit.entry !== "timer" || habit.reminderHour == null || habit.reminderMinute == null) {
              continue;
            }
            await syncDailyReminder({
              habitId: habit.id,
              habitName: habit.name,
              hour: habit.reminderHour,
              minute: habit.reminderMinute,
              todayWrapped,
            });
          }
          const hourRaw = await readSetting(database, EVENING_HOUR_KEY);
          const minuteRaw = await readSetting(database, EVENING_MINUTE_KEY);
          const hour = hourRaw == null ? null : Number(hourRaw);
          const minute = minuteRaw == null ? null : Number(minuteRaw);
          if (hour != null && minute != null && Number.isInteger(hour) && Number.isInteger(minute)) {
            await syncEveningWrap(hour, minute, todayWrapped);
          }
        } catch {
          // A reminder that cannot be scheduled stays off. The rest of the app still opens.
        }
      })
      .catch(() => {
        if (!live) return;
        logOpenFailed();
        setFatal(OPEN_FAILED);
      });
    return () => {
      live = false;
    };
  }, []);

  mutedRef.current = prefs?.muted ?? true;

  const bindBack = useCallback((handler: (() => boolean) | null) => {
    sheetBack.current = handler;
  }, []);

  function onGesture() {
    if (!mutedRef.current) loop.current?.start();
  }

  function back() {
    onGesture();
    if (sheetBack.current?.()) return;
    setStack((current) => (current.length > 1 ? current.slice(0, -1) : current));
  }

  function exitHome() {
    onGesture();
    sheetBack.current = null;
    setStack([{ kind: "home" }]);
  }

  function openTab(id: TabId) {
    onGesture();
    if (id === "home") {
      sheetBack.current = null;
      setStack([{ kind: "home" }]);
      return;
    }
    setStack((current) => {
      const top = current[current.length - 1];
      if (top?.kind === id) return current;
      if (id === "templates" && top?.kind === "template-editor") return current.slice(0, -1);
      let existing = -1;
      for (let index = current.length - 1; index >= 0; index -= 1) {
        if (current[index]?.kind === id) {
          existing = index;
          break;
        }
      }
      if (existing >= 0) return current.slice(0, existing + 1);
      return [...current, { kind: id }];
    });
  }

  function push(next: Place) {
    onGesture();
    setStack((current) => [...current, next]);
  }

  const todayId = currentMonth().id;
  const monthId = place.kind === "month" ? place.monthId : todayId;

  return (
    <View style={styles.root}>
      <CalmLoop ref={loop} />
      <View style={styles.bodySlot}>
        {fatal ? (
          <View style={styles.fallback}>
            <BrandLockup />
            <Text style={styles.body}>{fatal}</Text>
          </View>
        ) : null}
        {!fatal && !prefs ? (
          <View style={styles.fallback}>
            <BrandLockup />
            <Text style={styles.body}>Opening…</Text>
          </View>
        ) : null}
        {!fatal && prefs && place.kind !== "home" && place.kind !== "profile" && place.kind !== "ideas" ? (
          <ScreenNav onBack={back} onExit={exitHome} />
        ) : null}
        {!fatal && prefs && place.kind === "home" ? (
          <HomeScreen
            name={prefs.name}
            onName={(name) => setPrefs({ ...prefs, name })}
            onOpenToday={() => push({ kind: "today" })}
            onAddHabit={() => push({ kind: "today", openAdd: true })}
            onOpenMonth={(monthId) => push({ kind: "month", monthId })}
            onOpenScore={() => push({ kind: "score" })}
            onGesture={onGesture}
          />
        ) : null}
        {!fatal && prefs && (place.kind === "today" || place.kind === "month") ? (
          <MonthScreen
            key={monthId}
            monthId={monthId}
            openAdd={place.kind === "today" && place.openAdd === true}
            review={place.kind === "month"}
            bindBack={bindBack}
            onOpenScore={
              place.kind === "month" ? () => push({ kind: "score", monthId: place.monthId }) : undefined
            }
          />
        ) : null}
        {!fatal && prefs && place.kind === "score" ? <ScoreScreen monthId={place.monthId} /> : null}
        {!fatal && prefs && place.kind === "ideas" ? <IdeasScreen onGesture={onGesture} /> : null}
        {!fatal && prefs && place.kind === "profile" ? (
          <ProfileScreen
            name={prefs.name}
            muted={prefs.muted}
            onName={(name) => setPrefs({ ...prefs, name })}
            onMuted={(muted) => setPrefs({ ...prefs, muted })}
            onGesture={onGesture}
            onStart={() => loop.current?.start()}
            onStop={() => loop.current?.stop()}
          />
        ) : null}
        {!fatal && prefs && (place.kind === "templates" || place.kind === "template-editor") ? (
          <TemplatesScreen
            key={place.kind === "template-editor" ? `edit-${place.templateId ?? "new"}` : "templates"}
            editing={place.kind === "template-editor"}
            templateId={place.kind === "template-editor" ? (place.templateId ?? null) : null}
            onBegin={() => push({ kind: "template-editor" })}
            onEdit={(templateId) => push({ kind: "template-editor", templateId })}
            onDone={() => setStack((current) => (current.length > 1 ? current.slice(0, -1) : current))}
            onOpenToday={() => push({ kind: "today" })}
            onGesture={onGesture}
          />
        ) : null}
      </View>
      {prefs ? <TabBar tab={tabFor(place)} onChange={openTab} onGesture={onGesture} /> : null}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <ScreenBoundary>
        <Shell />
      </ScreenBoundary>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
    height: "100%",
    backgroundColor: ink.ground,
  },
  bodySlot: { flex: 1, minHeight: 0 },
  fallback: {
    flex: 1,
    backgroundColor: ink.ground,
    padding: 24,
    justifyContent: "center",
  },
  body: {
    marginTop: 12,
    fontSize: 16,
    lineHeight: 22,
    color: ink.body,
  },
});
