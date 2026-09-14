import { afterEach, describe, expect, it, vi } from "vitest";

import { getNutritionReport } from "../src/api/reports";
import { reportFixture } from "./report-fixtures";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("nutrition report API boundary", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("serializes accepted query fields and returns the root report envelope", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://api.example.test/api/v1");
    const report = reportFixture();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(report));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getNutritionReport({
        start_date: "2026-09-10",
        end_date: "2026-09-15",
        group_by: "week",
        page: 2,
        page_size: 20,
      }),
    ).resolves.toEqual(report);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.example.test/api/v1/reports/nutrition?start_date=2026-09-10&end_date=2026-09-15&group_by=week&page=2&page_size=20",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("rejects a malformed success payload instead of manufacturing zero totals", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ data: reportFixture() })),
    );
    await expect(getNutritionReport()).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      message: "The server returned an invalid nutrition report.",
    });
  });
});
