import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
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

export function MacroBreakdownChart({
  items,
  grouping,
}: {
  items: ReportBucket[];
  grouping: NutritionReport["range"]["group_by"];
}) {
  const data = items.map((item) => ({
    label: bucketLabel(item, grouping),
    protein: item.protein_g,
    carbohydrates: item.carbs_g,
    fat: item.fat_g,
  }));

  return (
    <section className="report-section chart-section" aria-labelledby="macro-chart-title">
      <div className="report-section-heading">
        <div>
          <p className="eyebrow">Independent gram totals</p>
          <h2 id="macro-chart-title">Macronutrient breakdown</h2>
        </div>
        <p>Protein, carbohydrates, and fat by {grouping}</p>
      </div>
      <div className="chart-frame" data-chart="macros">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart
            accessibilityLayer
            data={data}
            margin={{ top: 12, right: 12, bottom: 12, left: 4 }}
            title="Macronutrient breakdown"
            desc={"Protein, carbohydrates, and fat in grams for each returned " + grouping}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" minTickGap={24} />
            <YAxis width={52} unit=" g" />
            <Tooltip formatter={(value) => typeof value === "number" ? formatAmount(value) + " g" : value} />
            <Legend />
            <Bar dataKey="protein" name="Protein" fill="#28643d" isAnimationActive={false} />
            <Bar dataKey="carbohydrates" name="Carbohydrates" fill="#9b5d10" isAnimationActive={false} />
            <Bar dataKey="fat" name="Fat" fill="#6277a6" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="data-disclosure">
        <summary>View macronutrient data</summary>
        <div className="table-scroll">
          <table>
            <caption>Exact macronutrient values in grams</caption>
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th scope="col">Coverage</th>
                <th scope="col">Protein</th>
                <th scope="col">Carbohydrates</th>
                <th scope="col">Fat</th>
                <th scope="col">Diary state</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.covered_start + item.covered_end}>
                  <th scope="row">{bucketLabel(item, grouping)}</th>
                  <td>{bucketCoverage(item)}</td>
                  <td>{formatAmount(item.protein_g)} g</td>
                  <td>{formatAmount(item.carbs_g)} g</td>
                  <td>{formatAmount(item.fat_g)} g</td>
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
