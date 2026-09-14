import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { NutritionReport, ReportBucket } from "../../types";
import {
  bucketCoverage,
  bucketLabel,
  bucketStatus,
  formatAmount,
} from "../../utils/report-format";

interface CaloriePoint {
  label: string;
  calories: number | null;
  status: string;
}

export function CalorieTrendChart({
  items,
  grouping,
}: {
  items: ReportBucket[];
  grouping: NutritionReport["range"]["group_by"];
}) {
  const data: CaloriePoint[] = items.map((item) => ({
    label: bucketLabel(item, grouping),
    // Future empty buckets remain on the axis but are not presented as a
    // successful zero-intake day.
    calories:
      item.temporal_state === "future" && item.entry_count === 0
        ? null
        : item.calories_kcal,
    status: bucketStatus(item),
  }));

  return (
    <section className="report-section chart-section" aria-labelledby="calorie-chart-title">
      <div className="report-section-heading">
        <div>
          <p className="eyebrow">{grouping === "day" ? "Daily" : "Weekly"} buckets</p>
          <h2 id="calorie-chart-title">Calorie trend</h2>
        </div>
        <p>kcal per returned calendar {grouping}</p>
      </div>
      <div className="chart-frame" data-chart="calorie">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart
            accessibilityLayer
            data={data}
            margin={{ top: 12, right: 12, bottom: 12, left: 4 }}
            title="Calorie trend"
            desc={"Calories in kilocalories for each returned " + grouping}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" minTickGap={24} />
            <YAxis width={58} unit=" kcal" />
            <Tooltip
              formatter={(value) => [
                typeof value === "number" ? formatAmount(value) + " kcal" : "Future",
                "Calories",
              ]}
            />
            <Bar dataKey="calories" name="Calories" fill="#28643d" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="data-disclosure">
        <summary>View calorie trend data</summary>
        <div className="table-scroll">
          <table>
            <caption>Exact calorie values and diary state</caption>
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th scope="col">Coverage</th>
                <th scope="col">Calories</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.covered_start + item.covered_end}>
                  <th scope="row">{bucketLabel(item, grouping)}</th>
                  <td>{bucketCoverage(item)}</td>
                  <td>{formatAmount(item.calories_kcal)} kcal</td>
                  <td>{bucketStatus(item)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
