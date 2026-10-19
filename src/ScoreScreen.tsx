import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { loadMonth, openAppDatabase } from "./db";
import { logOpenFailed, OPEN_FAILED } from "./errors";
import { scoreStoredMonth, type MonthScore } from "./score";
import { ui } from "./theme";

export function ScoreScreen() {
  const [score, setScore] = useState<MonthScore | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    openAppDatabase()
      .then((database) => loadMonth(database))
      .then((month) => {
        if (live) setScore(scoreStoredMonth(month));
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
      {score ? <ScoreBody score={score} /> : null}
    </ScrollView>
  );
}

function ScoreBody({ score }: { score: MonthScore }) {
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
      <Text style={ui.section}>Focus</Text>
      {score.focus.length ? (
        score.focus.map((item, index) => (
          <Text key={item.label} style={ui.body} testID={`score-focus-${index}`}>
            {item.label} · {item.misses}
          </Text>
        ))
      ) : (
        <Text style={ui.body}>None yet</Text>
      )}
    </View>
  );
}
