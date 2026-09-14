import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { CalorieTrendChart } from "../components/reports/CalorieTrendChart";
import { GoalComparison } from "../components/reports/GoalComparison";
import { MacroBreakdownChart } from "../components/reports/MacroBreakdownChart";
import { MicronutrientSummary } from "../components/reports/MicronutrientSummary";
import { ReportSummary } from "../components/reports/ReportSummary";
import { EmptyState, ErrorMessage, LoadingState, StatusMessage } from "../components/UiState";
import { useNutritionReport } from "../hooks/useNutritionReport";
import type { ReportDraft } from "../validation/reports";
import {
  REPORT_PAGE_SIZES,
  addCalendarDays,
  isReportGrouping,
  parseReportSearch,
  reportSearch,
  validateReportDraft,
  weekBounds,
} from "../validation/reports";

export function Reports() {
  const [searchParams, setSearchParams] = useSearchParams();
  const searchText = searchParams.toString();
  const parsed = useMemo(
    () => parseReportSearch(new URLSearchParams(searchText)),
    [searchText],
  );
  const parameters = useMemo(
    () => parsed.value ?? { group_by: "day" as const, page: 1, page_size: 20 },
    [parsed.value],
  );
  const reportState = useNutritionReport(parameters, parsed.value !== null);
  const [draft, setDraft] = useState<ReportDraft>(parsed.draft);
  const [controlError, setControlError] = useState("");

  useEffect(() => {
    setDraft(parsed.draft);
    setControlError("");
  }, [parsed.draft, searchText]);

  useEffect(() => {
    if (
      reportState.data &&
      !searchParams.has("start_date") &&
      draft.start_date === "" &&
      draft.end_date === ""
    ) {
      // Backend-resolved dates populate the controls without turning a default
      // current-week URL into an explicit historical range.
      setDraft((current) => ({
        ...current,
        start_date: reportState.data?.range.start_date ?? "",
        end_date: reportState.data?.range.end_date ?? "",
      }));
    }
  }, [draft.end_date, draft.start_date, reportState.data, searchParams]);

  function applyDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validated = validateReportDraft(draft);
    if (!validated.value) {
      setControlError(validated.error);
      return;
    }
    setControlError("");
    setSearchParams(reportSearch(validated.value));
  }

  function resetCurrentWeek() {
    setControlError("");
    setSearchParams("");
  }

  function shiftWeek(days: number) {
    const anchor = reportState.data?.range.start_date || draft.start_date;
    if (!anchor) {
      return;
    }
    const current = weekBounds(anchor);
    const nextStart = addCalendarDays(current.start_date, days);
    const next = weekBounds(nextStart);
    const grouping = isReportGrouping(draft.group_by)
      ? draft.group_by
      : "day";
    setSearchParams(
      reportSearch({
        ...next,
        group_by: grouping,
        page: 1,
        page_size: Number(draft.page_size) || 20,
      }),
    );
  }

  const report = reportState.data;
  const pagination = report?.pagination;
  const outOfRange =
    report !== null &&
    report.items.length === 0 &&
    report.pagination.total_items > 0 &&
    report.pagination.page > report.pagination.total_pages;
  const firstVisible =
    report && report.items.length > 0
      ? (report.pagination.page - 1) * report.pagination.page_size + 1
      : 0;
  const lastVisible =
    report && report.items.length > 0
      ? firstVisible + report.items.length - 1
      : 0;

  return (
    <main className="content-shell">
      <header className="page-header report-header">
        <div>
          <p className="eyebrow">API-backed nutrition reporting</p>
          <h1>Nutrition reports</h1>
          <p>
            Explore exact full-range totals and paginated calendar buckets.
            Current targets are compared only across elapsed dates.
          </p>
        </div>
        <Link className="button primary" to="/meals/new">Log meal</Link>
      </header>

      <form className="report-controls" aria-label="Report controls" onSubmit={applyDraft} noValidate>
        <div className="report-control-grid">
          <label>
            Start date
            <input
              type="date"
              value={draft.start_date}
              onChange={(event) => setDraft((current) => ({ ...current, start_date: event.target.value }))}
            />
          </label>
          <label>
            End date
            <input
              type="date"
              value={draft.end_date}
              onChange={(event) => setDraft((current) => ({ ...current, end_date: event.target.value }))}
            />
          </label>
          <label>
            Group by
            <select
              value={draft.group_by}
              onChange={(event) => setDraft((current) => ({ ...current, group_by: event.target.value }))}
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
            </select>
          </label>
          <label>
            Buckets per page
            <select
              value={draft.page_size}
              onChange={(event) => setDraft((current) => ({ ...current, page_size: event.target.value }))}
            >
              {REPORT_PAGE_SIZES.map((size) => (
                <option value={size} key={size}>{size}</option>
              ))}
            </select>
          </label>
        </div>
        {(controlError || parsed.error) && (
          <p className="field-error report-control-error" role="alert">
            {controlError || parsed.error}
          </p>
        )}
        <div className="report-control-actions">
          <button className="button secondary" type="button" onClick={() => shiftWeek(-7)} disabled={!report && !draft.start_date}>
            Previous week
          </button>
          <button className="button primary" type="submit">Apply report</button>
          <button className="button secondary" type="button" onClick={resetCurrentWeek}>
            Current week
          </button>
          <button className="button secondary" type="button" onClick={() => shiftWeek(7)} disabled={!report && !draft.start_date}>
            Next week
          </button>
        </div>
      </form>

      {parsed.error && (
        <EmptyState
          title="Correct the report URL"
          action={<button className="button secondary" type="button" onClick={resetCurrentWeek}>Reset to current week</button>}
        >
          The URL contains invalid report parameters. Your entered values remain in the controls.
        </EmptyState>
      )}
      {!parsed.error && reportState.loading && <LoadingState message="Loading nutrition report..." />}
      {!parsed.error && reportState.error && !report && (
        <ErrorMessage error={reportState.error} onRetry={reportState.retry} title="Nutrition report unavailable" />
      )}

      {report && (
        <>
          <section className="report-context" aria-label="Report scope">
            <div>
              <span>Selected range</span>
              <strong>{report.range.start_date} to {report.range.end_date}</strong>
            </div>
            <div>
              <span>Application timezone</span>
              <strong>{report.range.timezone}</strong>
            </div>
            <div>
              <span>Grouping</span>
              <strong>{report.range.group_by === "day" ? "Daily" : "Calendar week"}</strong>
            </div>
          </section>
          {reportState.refreshing && <StatusMessage tone="neutral">Refreshing this report...</StatusMessage>}
          {reportState.error && (
            <ErrorMessage error={reportState.error} onRetry={reportState.retry} title="Could not refresh report" />
          )}
          {report.summary.entry_count === 0 && (
            <EmptyState title="No meals logged in this range" action={<Link className="button primary" to="/meals/new">Log meal</Link>}>
              Calendar context and current-goal guidance remain visible. Zero totals do not prove zero consumption.
            </EmptyState>
          )}

          <ReportSummary report={report} />
          <MicronutrientSummary summary={report.summary} />
          <GoalComparison report={report} />

          <section className="bucket-scope" aria-live="polite">
            <h2>Paginated chart buckets</h2>
            <p>
              {report.items.length > 0
                ? "Showing " + firstVisible + "–" + lastVisible + " of " + report.pagination.total_items + " " + (report.range.group_by === "day" ? "days" : "weeks") + "."
                : "Showing no periods on this page; " + report.pagination.total_items + " total " + (report.range.group_by === "day" ? "days" : "weeks") + "."}
              {" "}Full-range panels above do not change with chart pages.
            </p>
          </section>

          {outOfRange ? (
            <EmptyState
              title="No periods on this page"
              action={<button className="button secondary" type="button" onClick={() => setSearchParams(reportSearch({ ...parameters, page: 1 }))}>Go to first page</button>}
            >
              Full-range totals remain available above. Choose a valid chart page.
            </EmptyState>
          ) : (
            report.items.length > 0 && (
              <div className="chart-grid">
                <CalorieTrendChart items={report.items} grouping={report.range.group_by} />
                <MacroBreakdownChart items={report.items} grouping={report.range.group_by} />
              </div>
            )
          )}

          {pagination && pagination.total_pages > 1 && (
            <nav className="pagination" aria-label="Report bucket pages">
              <p>Page {pagination.page} of {pagination.total_pages}</p>
              <div className="button-row">
                <button
                  className="button secondary"
                  type="button"
                  disabled={pagination.page <= 1}
                  onClick={() => setSearchParams(reportSearch({ ...parameters, page: pagination.page - 1 }))}
                >
                  Previous
                </button>
                <button
                  className="button secondary"
                  type="button"
                  disabled={pagination.page >= pagination.total_pages}
                  onClick={() => setSearchParams(reportSearch({ ...parameters, page: pagination.page + 1 }))}
                >
                  Next
                </button>
              </div>
            </nav>
          )}
        </>
      )}
    </main>
  );
}
