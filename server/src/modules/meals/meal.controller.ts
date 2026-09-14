import type { Request, Response } from "express";

import type { MealService } from "./meal.service.js";

export function createMealController(mealService: MealService) {
  return {
    async createMeal(_request: Request, response: Response): Promise<void> {
      const meal = await mealService.createMeal(
        response.locals.validated.body,
      );
      response
        .location("/api/v1/meals/" + meal.id)
        .status(201)
        .json({ data: meal });
    },

    async listMeals(_request: Request, response: Response): Promise<void> {
      const result = await mealService.listMeals(
        response.locals.validated.query,
      );
      response.json(result);
    },

    async getMeal(_request: Request, response: Response): Promise<void> {
      const meal = await mealService.getMeal(
        response.locals.validated.params.id,
      );
      response.json({ data: meal });
    },

    async updateMeal(_request: Request, response: Response): Promise<void> {
      const meal = await mealService.updateMeal(
        response.locals.validated.params.id,
        response.locals.validated.body,
      );
      response.json({ data: meal });
    },

    async deleteMeal(_request: Request, response: Response): Promise<void> {
      await mealService.deleteMeal(response.locals.validated.params.id);
      response.status(204).end();
    },
  };
}
