import assert from "node:assert/strict";
import test from "node:test";

import {
  chatPlanSchema,
  parseChatToolArguments,
  proposalPayloadSchema,
} from "../src/modules/chat/chat.schemas.js";
import { conversationTitleFromMessage } from "../src/modules/chat/chat.service.js";

test("chat allowlist rejects unknown tools and ownership arguments", () => {
  assert.equal(chatPlanSchema.safeParse({
    tool: "runShell",
    arguments_json: "{}",
    assistant_message: "Running a command.",
  }).success, false);

  const plan = chatPlanSchema.parse({
    tool: "listMeals",
    arguments_json: JSON.stringify({
      user_id: "00000000-0000-4000-8000-000000000001",
      page: "1",
      page_size: "20",
    }),
    assistant_message: "Listing meals.",
  });
  assert.throws(() => parseChatToolArguments(plan));
});

test("proposal payloads require complete validated application data", () => {
  assert.equal(proposalPayloadSchema.safeParse({
    kind: "meal_create",
    meal: {
      food_name: "Rice",
      meal_type: "lunch",
      consumption_date: "2026-09-12",
      consumed_quantity: 150,
      quantity_unit: "g",
    },
  }).success, false);

  assert.equal(proposalPayloadSchema.safeParse({
    kind: "goals_replace",
    goals: {
      daily_calories_kcal: 2000,
      daily_protein_g: null,
      daily_carbs_g: null,
      daily_fat_g: null,
      target_weight_kg: null,
      user_id: "00000000-0000-4000-8000-000000000001",
    },
    expected_updated_at: "2026-09-12T10:00:00.000Z",
  }).success, false);
});


test("conversation titles use a compact, bounded first-message summary", () => {
  assert.equal(
    conversationTitleFromMessage("  I had 150 g of cooked rice   for lunch today.  "),
    "I had 150 g of cooked rice for lunch today.",
  );

  const title = conversationTitleFromMessage(
    "Please show every breakfast and lunch entry from last week, including all nutrition details, goal comparisons, assumptions, and missing micronutrients.",
  );
  assert.ok(title.length <= 64);
  assert.match(title, /…$/);
});