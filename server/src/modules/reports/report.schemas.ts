import { z } from "zod";

import {
  compareCalendarDates,
  inclusiveDayCount,
  isValidCalendarDate,
} from "../../utils/calendar.js";
import {
  calendarDateQuery,
  positiveIntegerQuery,
} from "../meals/meal.schemas.js";

export const REPORT_GROUPINGS = ["day", "week"] as const;

export const reportQuerySchema = z
  .strictObject({
    start_date: calendarDateQuery.optional(),
    end_date: calendarDateQuery.optional(),
    group_by: z
      .enum(REPORT_GROUPINGS)
      .optional()
      .transform((value) => value ?? "day"),
    page: positiveIntegerQuery({ maximum: 2_147_483_647 })
      .optional()
      .transform((value) => value ?? 1),
    page_size: positiveIntegerQuery({ maximum: 100 })
      .optional()
      .transform((value) => value ?? 20),
  })
  .superRefine((query, context) => {
    const hasStart = query.start_date !== undefined;
    const hasEnd = query.end_date !== undefined;

    if (hasStart !== hasEnd) {
      context.addIssue({
        code: "custom",
        path: [hasStart ? "end_date" : "start_date"],
        message: "start_date and end_date must be supplied together.",
      });
      return;
    }

    if (
      hasStart &&
      isValidCalendarDate(query.start_date) &&
      isValidCalendarDate(query.end_date)
    ) {
      if (compareCalendarDates(query.start_date, query.end_date) > 0) {
        context.addIssue({
          code: "custom",
          path: ["end_date"],
          message: "Must be on or after start_date.",
        });
        return;
      }

      if (inclusiveDayCount(query.start_date, query.end_date) > 366) {
        context.addIssue({
          code: "custom",
          path: ["end_date"],
          message: "Report ranges may contain at most 366 inclusive dates.",
        });
      }
    }
  });

export type ReportQuery = z.output<typeof reportQuerySchema>;
