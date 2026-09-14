import { describe, expect, it } from "vitest";

import {
  addCalendarDays,
  parseReportSearch,
  reportSearch,
  validateReportDraft,
  weekBounds,
} from "../src/validation/reports";

describe("report URL and date validation", () => {
  it("accepts a leap-year 366-day range and rejects 367 dates", () => {
    expect(
      validateReportDraft({
        start_date: "2024-01-01",
        end_date: "2024-12-31",
        group_by: "day",
        page_size: "100",
      }).error,
    ).toBe("");
    expect(
      validateReportDraft({
        start_date: "2024-01-01",
        end_date: "2025-01-01",
        group_by: "day",
        page_size: "100",
      }).error,
    ).toMatch(/at most 366/);
  });

  it("rejects one-sided, reversed, and impossible ranges while accepting future dates", () => {
    expect(parseReportSearch(new URLSearchParams("start_date=2026-09-01")).error).toMatch(/supplied together/);
    expect(parseReportSearch(new URLSearchParams("start_date=2026-09-13&end_date=2026-09-12")).error).toMatch(/on or after/);
    expect(parseReportSearch(new URLSearchParams("start_date=2026-02-30&end_date=2026-03-01")).error).toMatch(/real dates/);
    expect(parseReportSearch(new URLSearchParams("start_date=2027-01-01&end_date=2027-01-07")).value).toMatchObject({
      start_date: "2027-01-01",
      end_date: "2027-01-07",
    });
  });

  it("rejects duplicates, unknown keys, invalid grouping, and invalid paging", () => {
    expect(parseReportSearch(new URLSearchParams("page=1&page=2")).error).toMatch(/only once/);
    expect(parseReportSearch(new URLSearchParams("meal_type=lunch")).error).toMatch(/Unsupported/);
    expect(parseReportSearch(new URLSearchParams("group_by=month")).error).toMatch(/Day or Week/);
    expect(parseReportSearch(new URLSearchParams("page_size=101")).error).toMatch(/no greater than 100/);
    expect(parseReportSearch(new URLSearchParams("page=0")).error).toMatch(/positive whole/);
  });

  it("preserves valid applied values through URL serialization", () => {
    const search = reportSearch({
      start_date: "2026-09-10",
      end_date: "2026-09-15",
      group_by: "week",
      page: 3,
      page_size: 50,
    });
    expect(parseReportSearch(search).value).toEqual({
      start_date: "2026-09-10",
      end_date: "2026-09-15",
      group_by: "week",
      page: 3,
      page_size: 50,
    });
  });

  it("uses UTC date-only arithmetic for Monday weeks without timezone shifts", () => {
    expect(weekBounds("2026-09-13")).toEqual({
      start_date: "2026-09-07",
      end_date: "2026-09-13",
    });
    expect(addCalendarDays("2024-02-28", 1)).toBe("2024-02-29");
  });
});
