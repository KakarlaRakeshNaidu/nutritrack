import type { NutritionReport } from "../../types";
import { formatAmount } from "../../utils/report-format";

export function ReportSummary({
  report,
  title = "Full-range totals",
}: {
  report: NutritionReport;
  title?: string;
}) {
  const metrics = [
    ["Calories", report.summary.calories_kcal, "kcal"],
    ["Protein", report.summary.protein_g, "g"],
    ["Carbohydrates", report.summary.carbs_g, "g"],
    ["Fat", report.summary.fat_g, "g"],
  ] as const;

  return (
    <section className="report-section" aria-labelledby="summary-title">
      <div className="report-section-heading">
        <div>
          <p className="eyebrow">Entire selected range</p>
          <h2 id="summary-title">{title}</h2>
        </div>
        <p>
          {report.summary.entry_count}{" "}
          {report.summary.entry_count === 1 ? "entry" : "entries"} across{" "}
          {report.summary.logged_day_count} logged{" "}
          {report.summary.logged_day_count === 1 ? "day" : "days"}
        </p>
      </div>
      <dl className="metric-grid">
        {metrics.map(([label, value, unit]) => (
          <div className="metric-card" key={label}>
            <dt>{label}</dt>
            <dd>
              {formatAmount(value)} <span>{unit}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
