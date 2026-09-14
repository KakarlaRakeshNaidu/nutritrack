import type { Request, Response } from "express";

import type { GoalService } from "./goal.service.js";

export function createGoalController(goalService: GoalService) {
  return {
    async getGoals(_request: Request, response: Response): Promise<void> {
      const goals = await goalService.getGoals();
      response.json({ data: goals });
    },

    async replaceGoals(_request: Request, response: Response): Promise<void> {
      const goals = await goalService.replaceGoals(
        response.locals.validated.body,
      );
      response.json({ data: goals });
    },
  };
}
