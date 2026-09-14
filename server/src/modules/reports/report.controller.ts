import type { Request, Response } from "express";

import type { ReportService } from "./report.service.js";

export function createReportController(reportService: ReportService) {
  return {
    async getNutritionReport(_request: Request, response: Response): Promise<void> {
      const report = await reportService.getNutritionReport(
        response.locals.validated.query,
      );
      // Report collections intentionally live at the response root; wrapping
      // them would diverge from the documented collection contract.
      response.json(report);
    },
  };
}
