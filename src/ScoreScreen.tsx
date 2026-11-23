import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { loadMonth, openAppDatabase, openMonth, SAMPLE_MONTH_KEY, readSetting } from "./db";
import { logOpenFailed, OPEN_FAILED } from "./errors";
import { monthTitle } from "./month";
import { scoreStoredMonth, weeklyEase, easeSentence, type MonthScore } from "./score";
import { ink, ui } from "./theme";

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
        const ease = weeklyEase(month, when);
        setFocus(ease ? { label: easeSentence(ease), misses: 0 } : null);
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
      <View>
        <Text style={ui.title} accessibilityRole="header">
          {title}
        </Text>
        <Text style={[ui.quiet, { marginTop: 4 }]} testID="score-about">
          How this month went. Done, miss, and one habit to make easier.
        </Text>
      </View>
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
          <ScoreTable score={score} />
        </View>
      )}
      <Text style={ui.section}>This week</Text>
      {focus ? (
        <Text style={ui.body} testID="score-week">
          {focus.label}
        </Text>
      ) : (
        <Text style={ui.body} testID="score-week">
          None yet
        </Text>
      )}
    </View>
  );
}

function ScoreTable({ score }: { score: MonthScore }) {
  return (
    <View style={table.box} testID="score-table">
      <View style={[table.row, table.head]}>
        <Text style={[table.habit, table.headText]}>Habit</Text>
        <Text style={table.countHead}>Done</Text>
        <Text style={table.countHead}>Miss</Text>
        <Text style={table.countHead}>Percent</Text>
      </View>
      {score.lines.length ? (
        score.lines.map((line) => {
          const done = line.doneDays.length;
          const miss = line.missDays.length;
          const closed = done + miss;
          const percent = closed === 0 ? null : Math.round((100 * done) / closed);
          return (
            <View
              key={line.id}
              style={table.row}
              accessibilityLabel={`${line.name}, done ${done}, miss ${miss}${percent == null ? "" : `, ${percent} percent`}`}
            >
              <Text style={table.habit} numberOfLines={2}>
                {line.name}
              </Text>
              <Text style={table.count} testID={`score-done-${line.id}`}>
                {done}
              </Text>
              <Text style={table.count} testID={`score-miss-${line.id}`}>
                {miss}
              </Text>
              <Text style={table.count} testID={`score-percent-${line.id}`}>
                {percent == null ? "" : `${percent}%`}
              </Text>
            </View>
          );
        })
      ) : (
        <Text style={[ui.body, table.empty]} testID="score-done-none">
          None
        </Text>
      )}
      <View
        style={[table.row, table.total]}
        accessibilityLabel={`This month, done ${score.done}, miss ${score.miss}, ${score.percent ?? 0} percent`}
      >
        <Text style={table.habit}>This month</Text>
        <Text style={table.count} testID="score-done">
          {score.done}
        </Text>
        <Text style={table.count} testID="score-miss">
          {score.miss}
        </Text>
        <Text style={table.count} testID="score-month-percent">
          {score.percent == null ? "" : `${score.percent}%`}
        </Text>
      </View>
    </View>
  );
}

const table = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderColor: ink.line,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: ink.card,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: ink.line,
  },
  head: { borderTopWidth: 0 },
  total: { backgroundColor: ink.ground },
  habit: { flex: 1, color: ink.body, fontSize: 16, lineHeight: 22 },
  headText: { color: ink.quiet, fontSize: 13, fontWeight: "600" },
  count: { width: 64, textAlign: "right", color: ink.text, fontSize: 16, fontWeight: "700" },
  countHead: { width: 64, textAlign: "right", color: ink.quiet, fontSize: 13, fontWeight: "600" },
  empty: { paddingHorizontal: 12, paddingVertical: 8 },
});
