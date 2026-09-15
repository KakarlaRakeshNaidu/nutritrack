import { loadEnv } from "../src/config/env.js";
import { createGeminiEstimateAdapter } from "../src/modules/nutrition/gemini-estimate.adapter.js";
import { buildEstimateResult } from "../src/modules/nutrition/nutrition-estimate.schemas.js";

const config = loadEnv();
const controller = new AbortController();
const deadline = setTimeout(() => controller.abort("live-check-timeout"), 30_000);
deadline.unref();

try {
  const output = await createGeminiEstimateAdapter(config.providers.gemini).estimate({
    basics: {
      food_name: "cooked brown rice",
      meal_type: "lunch",
      consumption_date: "2026-09-12",
      consumed_quantity: 200,
      quantity_unit: "g",
    },
    signal: controller.signal,
    timeoutMs: 25_000,
  });
  const result = buildEstimateResult(output);
  console.log(JSON.stringify({
    provider: result.provider,
    status: result.status,
    is_estimate: result.is_estimate,
    known_core_fields: Object.entries(result.nutrition)
      .filter(([name, value]) => name !== "micronutrients" && value !== null)
      .map(([name]) => name),
    missing_fields: result.missing_fields,
    assumptions_count: result.assumptions.length,
    clarification_present: result.clarification !== null,
  }));
} finally {
  clearTimeout(deadline);
}
