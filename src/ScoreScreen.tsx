import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { loadMonth, openAppDatabase, openMonth, SAMPLE_MONTH_KEY, readSetting } from "./db";
import { logOpenFailed, OPEN_FAILED } from "./errors";
import { monthTitle } from "./month";
import { scoreStoredMonth, weeklyFocusTag, type MonthScore } from "./score";
import { ui } from "./theme";

export function ScoreScreen({ monthId }: { monthId?: string }) {
  const [score, setScore] = useState<MonthScore | null>(null);
  const [focus, setFocus] = useState<{ label: string; misses: number } | null>(null);
  const [title, setTitle] = useState("Score");
  const [sample, setSample] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    openAppDatabase()
      .then(async (database) => {
        const month = monthId ? await openMonth(database, monthId) : await loadMonth(database);
        const flagged = await readSetting(database, SAMPLE_MONTH_KEY);
        return { month, sample: flagged === month.id };
      })
      .then(({ month, sample: isSample }) => {
        if (!live) return;
        const current = new Date();
        const inMonth = month.year === current.getFullYear() && month.month === current.getMonth() + 1;
        const when = inMonth ? current : new Date(month.year, month.month, 0);
        setTitle(monthTitle(month.year, month.month));
        setSample(isSample);
        setScore(scoreStoredMonth(month, when));
        setFocus(weeklyFocusTag(month, when));
      })
      .catch(() => {
        if (!live) return;
        logOpenFailed();
        setFatal(OPEN_FAILED);
      });
    return () => {
      live = false;
    };
  }, [monthId]);

  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.page} testID="score-screen">
      <Text style={ui.title} accessibilityRole="header">
        {title}
      </Text>
      {sample ? (
        <Text style={ui.quiet} testID="sample-score">
          Sample
        </Text>
      ) : null}
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
          <Text style={ui.section}>Done</Text>
          <DayList lines={score.lines} kind="done" empty="None" />
          <Text style={ui.section}>Miss</Text>
          <DayList lines={score.lines} kind="miss" empty="None" />
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

function DayList({
  lines,
  kind,
  empty,
}: {
  lines: MonthScore["lines"];
  kind: "done" | "miss";
  empty: string;
}) {
  const shown = lines.filter((line) => (kind === "done" ? line.doneDays.length : line.missDays.length));
  if (!shown.length) {
    return (
      <Text style={ui.body} testID={`score-${kind}-none`}>
        {empty}
      </Text>
    );
  }
  return (
    <View style={ui.stack}>
      {shown.map((line) => {
        const days = kind === "done" ? line.doneDays : line.missDays;
        return (
          <Text key={line.id} style={ui.body} testID={`score-${kind}-${line.id}`}>
            {line.name} · {days.join(", ")}
          </Text>
        );
      })}
    </View>
  );
}
