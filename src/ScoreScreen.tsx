import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { loadMonth, openAppDatabase } from "./db";
import { logOpenFailed, OPEN_FAILED } from "./errors";
import { scoreStoredMonth, weeklyFocusTag, type MonthScore } from "./score";
import { ui } from "./theme";

export function ScoreScreen() {
  const [score, setScore] = useState<MonthScore | null>(null);
  const [focus, setFocus] = useState<{ label: string; misses: number } | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    openAppDatabase()
      .then((database) => loadMonth(database))
      .then((month) => {
        if (!live) return;
        setScore(scoreStoredMonth(month));
        setFocus(weeklyFocusTag(month));
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

  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.page} testID="score-screen">
      <Text style={ui.title} accessibilityRole="header">
        Score
      </Text>
      {fatal ? <Text style={ui.body}>{fatal}</Text> : null}
      {!fatal && !score ? <Text style={ui.body}>Opening…</Text> : null}
      {score ? <ScoreBody score={score} focus={focus} /> : null}
    </ScrollView>
  );
}

function ScoreBody({
  score,
  focus,
}: {
  score: MonthScore;
  focus: { label: string; misses: number } | null;
}) {
  return (
    <View testID="month-score-screen" style={ui.stack}>
      {score.percent == null ? (
        <Text style={ui.body} testID="score-empty">
          No closed days yet
        </Text>
      ) : (
        <View style={ui.stack}>
          <Text style={ui.percent} testID="score-percent">
            {score.percent}%
          </Text>
          <Text style={ui.body} testID="score-done">
            Done {score.done}
          </Text>
          <Text style={ui.body} testID="score-miss">
            Miss {score.miss}
          </Text>
        </View>
      )}
      <Text style={ui.section}>This week</Text>
      {focus ? (
        <Text style={ui.body} testID="score-week">
          {focus.label} · {focus.misses}
        </Text>
      ) : (
        <Text style={ui.body} testID="score-week">
          None yet
        </Text>
      )}
    </View>
  );
}
