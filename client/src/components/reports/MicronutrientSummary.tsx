import type { ReportSummary as ReportSummaryValues } from "../../types";
import { formatAmount } from "../../utils/report-format";

const NUTRIENTS = [
  ["sodium_mg", "Sodium"],
  ["calcium_mg", "Calcium"],
  ["iron_mg", "Iron"],
  ["potassium_mg", "Potassium"],
  ["vitamin_c_mg", "Vitamin C"],
  ["vitamin_d_mcg", "Vitamin D"],
] as const;

export function MicronutrientSummary({
  summary,
  compact = false,
}: {
  summary: ReportSummaryValues;
  compact?: boolean;
}) {
  return (
    <section className={"report-section " + (compact ? "compact-section" : "")} aria-labelledby="micro-title">
      <div className="report-section-heading">
        <div>
          <p className="eyebrow">Full-range data completeness</p>
          <h2 id="micro-title">Micronutrient summary</h2>
        </div>
        <p>Coverage shows recorded values, not dietary adequacy.</p>
      </div>
      <div className="micro-grid">
        {NUTRIENTS.map(([field, label]) => {
          const nutrient = summary.micronutrients[field];
          const noEntries = nutrient.entry_count === 0;
          return (
            <article className="micro-card" key={field}>
              <h3>{label}</h3>
              <p className="micro-value">
                {nutrient.known_total === null
                  ? "Unknown"
                  : formatAmount(nutrient.known_total) + " " + nutrient.unit}
              </p>
              <p>
                Known for {nutrient.known_count} of {nutrient.entry_count} entries
                {noEntries
                  ? " (no entries)"
                  : "; " + nutrient.unknown_count + " unknown"}
              </p>
              <progress
                aria-label={label + " recorded-value coverage"}
                max={Math.max(nutrient.entry_count, 1)}
                value={nutrient.known_count}
              />
            </article>
          );
        })}
      </div>
    </section>
  );
}
