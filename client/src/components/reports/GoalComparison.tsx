import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  GoalMetric,
  NutritionReport,
} from "../../types";
import { formatAmount, formatPercent } from "../../utils/report-format";

const METRICS = [
  ["calories_kcal", "Calories", "kcal"],
  ["protein_g", "Protein", "g"],
  ["carbs_g", "Carbohydrates", "g"],
  ["fat_g", "Fat", "g"],
] as const;

function comparisonText(metric: GoalMetric, unit: string): string {
  if (metric.target === null || metric.difference === null) {
    return "Not set";
  }
  if (metric.difference === 0) {
    return "Matches target";
  }
  return (
    formatAmount(Math.abs(metric.difference)) +
    " " +
    unit +
    (metric.difference > 0 ? " above target" : " below target")
  );
}

export function GoalComparison({
  report,
}: {
  report: NutritionReport;
}) {
  const comparison = report.goal_comparison;
  const scope =
    comparison.scope_start && comparison.scope_end
      ? comparison.scope_start + " to " + comparison.scope_end
      : "No elapsed dates";

  return (
    <section className="report-section" aria-labelledby="goal-comparison-title">
      <div className="report-section-heading">
        <div>
          <p className="eyebrow">Compared with current targets</p>
          <h2 id="goal-comparison-title">Goal versus actual</h2>
        </div>
        <p>
          {scope}; {comparison.day_count} elapsed{" "}
          {comparison.day_count === 1 ? "day" : "days"}. Future dates are excluded.
        </p>
      </div>
      {comparison.day_count === 0 && (
        <p className="inline-note">No elapsed dates are available for goal comparison yet.</p>
      )}
      <div className="goal-grid">
        {METRICS.map(([field, label, unit]) => {
          const metric = comparison[field];
          const targetSet = metric.target !== null;
          const data = targetSet
            ? [
                { name: "Actual", value: metric.actual },
                { name: "Target", value: metric.target },
              ]
            : [];
          return (
            <article className="goal-card" key={field}>
              <h3>{label}</h3>
              <dl>
                <div><dt>Actual</dt><dd>{formatAmount(metric.actual)} {unit}</dd></div>
                <div><dt>Target</dt><dd>{metric.target === null ? "Not set" : formatAmount(metric.target) + " " + unit}</dd></div>
                <div><dt>Difference</dt><dd>{comparisonText(metric, unit)}</dd></div>
                <div><dt>Percentage</dt><dd>{metric.percent === null ? "Not applicable" : formatPercent(metric.percent)}</dd></div>
              </dl>
              {targetSet && (
                <div className="goal-chart" data-chart={"goal-" + field}>
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <BarChart
                      accessibilityLayer
                      data={data}
                      layout="vertical"
                      margin={{ top: 4, right: 12, bottom: 4, left: 10 }}
                      title={label + " actual compared with target"}
                      desc={"Actual and current target in " + unit}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="name" width={54} />
                      <Tooltip formatter={(value) => typeof value === "number" ? formatAmount(value) + " " + unit : value} />
                      <Bar dataKey="value" fill="#28643d" isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </article>
          );
        })}
      </div>
      <p className="inline-note">
        Saved target weight:{" "}
        {report.goal_snapshot.target_weight_kg === null
          ? "Not set"
          : formatAmount(report.goal_snapshot.target_weight_kg) + " kg"}.
        No actual-weight progress is calculated.
      </p>
    </section>
  );
}
