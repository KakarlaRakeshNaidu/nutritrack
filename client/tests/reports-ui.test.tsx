import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getNutritionReport } from "../src/api/reports";
import { GoalComparison } from "../src/components/reports/GoalComparison";
import { MicronutrientSummary } from "../src/components/reports/MicronutrientSummary";
import { Home } from "../src/pages/Home";
import { Reports } from "../src/pages/Reports";
import type { NutritionReport } from "../src/types";
import { addCalendarDays } from "../src/validation/reports";
import {
  bucketFixture,
  comparisonFixture,
  reportFixture,
  summaryFixture,
} from "./report-fixtures";

vi.mock("../src/api/reports.js", () => ({
  getNutritionReport: vi.fn(),
}));
const getReportMock = vi.mocked(getNutritionReport);

function LocationProbe() {
  return <output data-testid="location">{useLocation().search}</output>;
}

function renderReports(entry = "/reports") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/reports" element={<><Reports /><LocationProbe /></>} />
        <Route path="/meals/new" element={<p>Meal editor</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("dashboard and nutrition reports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getReportMock.mockResolvedValue(reportFixture());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the current-week dashboard from the report response with exact accessible data", async () => {
    render(<MemoryRouter><Home /></MemoryRouter>);

    expect(await screen.findByText("Current-week logged totals")).toBeInTheDocument();
    expect(screen.getAllByText("250 kcal").length).toBeGreaterThan(0);
    expect(screen.getByText("25 entries across 1 logged day")).toBeInTheDocument();
    expect(screen.getAllByText("2026-09-13").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Future").length).toBeGreaterThan(0);
    expect(screen.getByText(/Saved target weight: 75 kg/)).toBeInTheDocument();
    expect(screen.getByText(/No actual-weight progress is calculated/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open this week in reports" })).toHaveAttribute(
      "href",
      expect.stringContaining("start_date=2026-09-07"),
    );
  });

  it("keeps full-range totals unchanged on a later bucket page and restores URL controls", async () => {
    const items = Array.from({ length: 20 }, (_, index) =>
      bucketFixture(addCalendarDays("2026-09-27", index)),
    );
    getReportMock.mockResolvedValue(
      reportFixture({
        range: {
          start_date: "2026-09-07",
          end_date: "2026-11-05",
          group_by: "day",
          timezone: "Asia/Kolkata",
          today: "2026-09-12",
        },
        items,
        pagination: {
          page: 2,
          page_size: 20,
          total_items: 60,
          total_pages: 3,
        },
      }),
    );
    renderReports("/reports?start_date=2026-09-07&end_date=2026-11-05&group_by=day&page=2&page_size=20");

    expect(await screen.findByText(/Showing 21–40 of 60 days\./)).toBeInTheDocument();
    expect(screen.getAllByText("250 kcal").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Start date")).toHaveValue("2026-09-07");
    expect(screen.getByLabelText("End date")).toHaveValue("2026-11-05");
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() =>
      expect(getReportMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, page_size: 20 }),
        expect.any(Object),
      ),
    );
  });

  it("retains invalid URL input and resets without issuing the invalid request", async () => {
    renderReports("/reports?start_date=2026-09-10&meal_type=lunch");

    expect(await screen.findByText(/URL contains invalid report parameters/)).toBeInTheDocument();
    expect(screen.getByLabelText("Start date")).toHaveValue("2026-09-10");
    expect(getReportMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reset to current week" }));
    await waitFor(() => expect(getReportMock).toHaveBeenCalledTimes(1));
  });

  it("applies controls as URL state and resets the bucket page", async () => {
    renderReports("/reports?start_date=2026-09-07&end_date=2026-09-13&group_by=day&page=3&page_size=20");
    await screen.findByText("Full-range totals");
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-09-10" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-09-15" } });
    fireEvent.change(screen.getByLabelText("Group by"), { target: { value: "week" } });
    fireEvent.change(screen.getByLabelText("Buckets per page"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply report" }));

    await waitFor(() => {
      const location = screen.getByTestId("location").textContent ?? "";
      expect(location).toContain("start_date=2026-09-10");
      expect(location).toContain("group_by=week");
      expect(location).toContain("page=1");
      expect(location).toContain("page_size=50");
    });
  });

  it("preserves full-range panels and offers first-page recovery for an empty out-of-range page", async () => {
    getReportMock.mockResolvedValue(
      reportFixture({
        items: [],
        pagination: {
          page: 99,
          page_size: 20,
          total_items: 7,
          total_pages: 1,
        },
      }),
    );
    renderReports("/reports?group_by=day&page=99&page_size=20");

    expect(await screen.findByRole("heading", { name: "No periods on this page" })).toBeInTheDocument();
    expect(screen.getAllByText("250 kcal").length).toBeGreaterThan(0);
    expect(screen.queryByText(/empty food diary/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go to first page" }));
    expect(screen.getByTestId("location").textContent).toContain("page=1");
  });

  it("keeps known zero, all-unknown, and no-entry micronutrient states distinct", () => {
    const reportSummary = summaryFixture();
    const { rerender } = render(<MicronutrientSummary summary={reportSummary} />);
    expect(screen.getByText("120 mg")).toBeInTheDocument();
    expect(screen.getByText("0 mg")).toBeInTheDocument();
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
    expect(screen.getByText("Known for 3 of 4 entries; 1 unknown")).toBeInTheDocument();

    rerender(
      <MicronutrientSummary
        summary={summaryFixture({
          entry_count: 0,
          logged_day_count: 0,
          micronutrients: {
            ...reportSummary.micronutrients,
            sodium_mg: {
              unit: "mg",
              known_total: null,
              known_count: 0,
              unknown_count: 0,
              entry_count: 0,
            },
          },
        })}
      />,
    );
    expect(screen.getByText("Known for 0 of 0 entries (no entries)")).toBeInTheDocument();
  });

  it("uses API goal values for zero, unset, above-target, and future-only comparisons", () => {
    const report = reportFixture({
      goal_comparison: comparisonFixture({
        calories_kcal: { actual: 2500, target: 2000, difference: 500, percent: 125 },
        protein_g: { actual: 10, target: 0, difference: 10, percent: null },
        carbs_g: { actual: 20, target: null, difference: null, percent: null },
      }),
    });
    const { rerender } = render(<GoalComparison report={report} />);
    expect(screen.getByText("125%")).toBeInTheDocument();
    expect(screen.getByText("500 kcal above target")).toBeInTheDocument();
    expect(screen.getAllByText("Not applicable").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not set").length).toBeGreaterThan(0);

    rerender(
      <GoalComparison
        report={reportFixture({
          goal_comparison: comparisonFixture({
            scope_start: null,
            scope_end: null,
            day_count: 0,
            calories_kcal: { actual: 0, target: null, difference: null, percent: null },
          }),
        })}
      />,
    );
    expect(screen.getByText(/No elapsed dates are available/)).toBeInTheDocument();
  });

  it("prevents a slow old response from replacing a newer applied range", async () => {
    let resolveOld: (report: NutritionReport) => void = () => {};
    getReportMock
      .mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce(reportFixture({ summary: summaryFixture({ calories_kcal: 600 }) }));

    renderReports();
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-09-10" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-09-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply report" }));

    expect(await screen.findByText("600", { selector: "dd" })).toBeInTheDocument();
    resolveOld(reportFixture({ summary: summaryFixture({ calories_kcal: 900 }) }));
    await waitFor(() =>
      expect(screen.getByText("600", { selector: "dd" })).toBeInTheDocument(),
    );
    expect(screen.queryByText("900", { selector: "dd" })).not.toBeInTheDocument();
  });

  it("keeps request failures distinct from empty reports and retries current parameters", async () => {
    getReportMock
      .mockRejectedValueOnce(new Error("Report service unavailable."))
      .mockResolvedValueOnce(reportFixture());
    renderReports("/reports?group_by=week&page=1&page_size=50");

    expect(await screen.findByText("Report service unavailable.")).toBeInTheDocument();
    expect(screen.queryByText("No meals logged in this range")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Full-range totals")).toBeInTheDocument();
    expect(getReportMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ group_by: "week", page: 1, page_size: 50 }),
      expect.any(Object),
    );
  });

  it("provides keyboard-operable data disclosures with exact decimal and aggregate values", async () => {
    getReportMock.mockResolvedValue(
      reportFixture({
        summary: summaryFixture({ calories_kcal: 1_500_000.3, protein_g: 0.3 }),
      }),
    );
    renderReports();
    const calorieDisclosure = await screen.findByText("View calorie trend data");
    expect(calorieDisclosure.closest("details")).toBeInTheDocument();
    expect(screen.getByText("1,500,000.3", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getAllByRole("table").length).toBeGreaterThanOrEqual(2);
    const calorieTable = screen.getByRole("table", { name: "Exact calorie values and diary state" });
    expect(within(calorieTable).getAllByText("No meals logged").length).toBeGreaterThan(0);
  });
});
