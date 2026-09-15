import { useMemo } from "react";
import { Link } from "react-router-dom";

import { CalorieTrendChart } from "../components/reports/CalorieTrendChart";
import { GoalComparison } from "../components/reports/GoalComparison";
import { MacroBreakdownChart } from "../components/reports/MacroBreakdownChart";
import { MicronutrientSummary } from "../components/reports/MicronutrientSummary";
import { ReportSummary } from "../components/reports/ReportSummary";
import { EmptyState, ErrorMessage, LoadingState, StatusMessage } from "../components/UiState";
import { useNutritionReport } from "../hooks/useNutritionReport";
import { reportSearch } from "../validation/reports";

export function Home() {
  const parameters = useMemo(
    () => ({ group_by: "day" as const, page: 1, page_size: 20 }),
    [],
  );
  const reportState = useNutritionReport(parameters);
  const report = reportState.data;
  const reportLink = report
    ? "/reports?" +
      reportSearch({
        start_date: report.range.start_date,
        end_date: report.range.end_date,
        group_by: "day",
        page: 1,
        page_size: 20,
      }).toString()
    : "/reports";

  return (
    <main className="content-shell dashboard-page">
      <section className="dashboard-hero" aria-labelledby="dashboard-title">
        <p className="eyebrow">Current-week dashboard</p>
        <h1 id="dashboard-title">Your nutrition week, in context.</h1>
        <p className="description">
          Review logged totals, calendar-day trends, data completeness, and
          current targets without losing the distinction between zero and unknown.
        </p>
        <div className="button-row hero-actions">
          <Link className="button primary" to="/meals/new">Log meal</Link>
          <Link className="button secondary" to="/meals/from-image">Log from photo</Link>
          <Link className="button secondary" to="/meals">Meal history</Link>
          <Link className="button secondary" to="/goals">Goals</Link>
          <Link className="button secondary" to={reportLink}>Reports</Link>
        </div>
      </section>

      {reportState.loading && <LoadingState message="Loading current-week dashboard..." />}
      {reportState.error && !report && (
        <ErrorMessage error={reportState.error} onRetry={reportState.retry} title="Dashboard report unavailable" />
      )}

      {report && (
        <>
          <section className="report-context dashboard-context" aria-label="Current week context">
            <div>
              <span>Resolved week</span>
              <strong>{report.range.start_date} to {report.range.end_date}</strong>
            </div>
            <div>
              <span>Application timezone</span>
              <strong>{report.range.timezone}</strong>
            </div>
            <div>
              <span>Backend today</span>
              <strong>{report.range.today}</strong>
            </div>
          </section>
          {reportState.refreshing && <StatusMessage tone="neutral">Refreshing dashboard data...</StatusMessage>}
          {reportState.error && (
            <ErrorMessage error={reportState.error} onRetry={reportState.retry} title="Could not refresh dashboard" />
          )}
          {report.summary.entry_count === 0 && (
            <EmptyState title="No meals logged this week" action={<Link className="button primary" to="/meals/new">Log meal</Link>}>
              The week and targets are still shown below. No entries means intake is unknown, not confirmed as zero.
            </EmptyState>
          )}
          <ReportSummary report={report} title="Current-week logged totals" />
          <div className="chart-grid">
            <CalorieTrendChart items={report.items} grouping="day" />
            <MacroBreakdownChart items={report.items} grouping="day" />
          </div>
          <MicronutrientSummary summary={report.summary} compact />
          <GoalComparison report={report} />
          <div className="dashboard-report-link">
            <Link className="button primary" to={reportLink}>Open this week in reports</Link>
          </div>
        </>
      )}
    </main>
  );
}
