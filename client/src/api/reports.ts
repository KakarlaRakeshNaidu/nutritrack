import { ApiError, apiRequest, queryString } from "./client";
import type { NutritionReport, ReportRequestParameters } from "../types";
import { nutritionReportSchema } from "../validation/reports";

export async function getNutritionReport(
  parameters: ReportRequestParameters = {},
  { signal }: { signal?: AbortSignal } = {},
): Promise<NutritionReport> {
  const payload = await apiRequest<unknown>(
    "/reports/nutrition" + queryString(parameters),
    { signal },
  );
  const parsed = nutritionReportSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError({
      code: "INVALID_RESPONSE",
      message: "The server returned an invalid nutrition report.",
    });
  }
  return parsed.data;
}
