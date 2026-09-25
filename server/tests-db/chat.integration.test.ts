import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createChatService } from "../src/modules/chat/chat.service.js";
import type { ChatPlanner } from "../src/modules/chat/chat.gemini.js";
import type { ChatPlan } from "../src/modules/chat/chat.schemas.js";
import { createDatabasePool } from "../src/db/pool.js";
import {
  discoverMigrations,
  quoteInternalIdentifier,
  runMigrations,
} from "../src/db/migration-runner.js";
import type { DatabasePool } from "../src/types.js";
import { recordingLogger } from "../support/testing.js";
import { loadDatabaseTestConfig } from "./database-test-config.js";

const NOW = new Date("2030-09-12T10:00:00.000Z");

function mealArguments(name: string): string {
  return JSON.stringify({
    food_name: name,
    meal_type: "lunch",
    consumption_date: "2026-09-12",
    consumed_quantity: 150,
    quantity_unit: "g",
    calories_kcal: 195,
    protein_g: 4,
    carbs_g: 42,
    fat_g: 0.5,
    micronutrients: {
      sodium_mg: null,
      calcium_mg: null,
      iron_mg: null,
      potassium_mg: null,
      vitamin_c_mg: null,
      vitamin_d_mcg: null,
    },
    entry_source: "manual",
    is_estimate: true,
  });
}

class PlannerQueue implements ChatPlanner {
  readonly plans: ChatPlan[] = [];

  async plan() {
    const plan = this.plans.shift();
    if (!plan) throw new Error("No deterministic chat plan remains.");
    return plan;
  }
}

test("chat proposals are private, reviewable, cancelable, and execute exactly once", async () => {
  const config = await loadDatabaseTestConfig();
  const rootPool = await createDatabasePool(config, { logger: recordingLogger() });
  const schema = "nutritrack_chat_" + randomUUID().replaceAll("-", "").slice(0, 16);
  const quoted = quoteInternalIdentifier(schema);
  let owned = false;

  function schemaPool(): DatabasePool {
    return {
      async connect() {
        const client = await rootPool.connect();
        await client.query("SELECT set_config('search_path', $1, false)", [quoted]);
        return client;
      },
      async query(query, values) {
        const client = await this.connect();
        try {
          return await client.query(query, values);
        } finally {
          client.release();
        }
      },
      async end() {},
    };
  }

  try {
    await rootPool.query("CREATE SCHEMA " + quoted);
    owned = true;
    const pool = schemaPool();
    const migrations = await discoverMigrations(new URL("../migrations/", import.meta.url));
    const first = await runMigrations({
      pool,
      migrations,
      schema,
      logger: recordingLogger(),
    });
    const second = await runMigrations({
      pool,
      migrations,
      schema,
      logger: recordingLogger(),
    });
    assert.equal(first.appliedCount, 3);
    assert.equal(second.appliedCount, 0);

    const userA = randomUUID();
    const userB = randomUUID();
    for (const [id, email] of [[userA, "chat-a@example.com"], [userB, "chat-b@example.com"]]) {
      await pool.query(
        "INSERT INTO nutritrack_users (id, email_normalized, password_hash) VALUES ($1, $2, $3)",
        [id, email, "scrypt$test"],
      );
      await pool.query(
        "INSERT INTO tracker_profile (user_id, display_name, timezone) VALUES ($1, $2, 'UTC')",
        [id, email],
      );
      await pool.query("INSERT INTO goals (user_id) VALUES ($1)", [id]);
    }

    const planner = new PlannerQueue();
    const service = createChatService({
      pool,
      providers: { gemini: { status: "disabled" } },
      planner,
      clock: () => NOW,
    });
    const conversation = await service.createConversation(userA);
    assert.equal(
      (await service.listConversations(userB, { page: 1, page_size: 20 })).items.length,
      0,
    );
    await assert.rejects(
      service.listMessages(userB, conversation.id, { page: 1, page_size: 20 }),
      /does not exist/,
    );

    planner.plans.push({
      tool: "proposeMealCreate",
      arguments_json: mealArguments("Chat rice"),
      assistant_message: "Review this meal.",
    });
    const turn = await service.submitMessage({
      userId: userA,
      conversationId: conversation.id,
      message: "I had 150 g of cooked rice for lunch today.",
      signal: new AbortController().signal,
    });
    const proposal = turn.assistant_message.proposal;
    assert.ok(proposal);
    assert.equal(proposal.status, "pending");
    assert.equal(
      (await service.listConversations(userA, { page: 1, page_size: 20 })).items[0]?.title,
      "I had 150 g of cooked rice for lunch today.",
    );
    await pool.query(
      "UPDATE chat_conversations SET title = 'New nutrition conversation' WHERE id = $1",
      [conversation.id],
    );
    assert.equal(
      (await service.listConversations(userA, { page: 1, page_size: 20 })).items[0]?.title,
      "I had 150 g of cooked rice for lunch today.",
      "legacy placeholder titles should display the first user message",
    );
    assert.equal(
      (await pool.query("SELECT count(*) AS count FROM meals WHERE user_id = $1", [userA])).rows[0]?.count,
      "0",
    );
    await assert.rejects(
      service.getProposal(userB, proposal.id),
      /does not exist/,
    );

    const confirmed = await service.confirmProposal(userA, proposal.id);
    const repeated = await service.confirmProposal(userA, proposal.id);
    assert.equal(confirmed.status, "confirmed");
    assert.deepEqual(repeated.outcome, confirmed.outcome);
    assert.equal(
      (await pool.query("SELECT count(*) AS count FROM meals WHERE user_id = $1", [userA])).rows[0]?.count,
      "1",
    );

    const savedMeal = (await pool.query(
      "SELECT id FROM meals WHERE user_id = $1 AND food_name = $2",
      [userA, "Chat rice"],
    )).rows[0];
    assert.ok(savedMeal);
    planner.plans.push({
      tool: "proposeMealUpdate",
      arguments_json: JSON.stringify({
        match: { id: savedMeal.id },
        changes: { food_name: "Stale replacement" },
      }),
      assistant_message: "Review this update.",
    });
    const staleTurn = await service.submitMessage({
      userId: userA,
      conversationId: conversation.id,
      message: "Rename that rice meal.",
      signal: new AbortController().signal,
    });
    assert.ok(staleTurn.assistant_message.proposal);
    await pool.query(
      "UPDATE meals SET updated_at = updated_at + interval '1 second' WHERE id = $1",
      [savedMeal.id],
    );
    await assert.rejects(
      service.confirmProposal(userA, staleTurn.assistant_message.proposal.id),
      /changed/,
    );
    assert.equal(
      (await pool.query("SELECT food_name FROM meals WHERE id = $1", [savedMeal.id])).rows[0]?.food_name,
      "Chat rice",
    );

    planner.plans.push({
      tool: "proposeGoalReplacement",
      arguments_json: JSON.stringify({ changes: { daily_protein_g: 100 } }),
      assistant_message: "Review this goal.",
    });
    const goalTurn = await service.submitMessage({
      userId: userA,
      conversationId: conversation.id,
      message: "Set my daily protein goal to 100 g.",
      signal: new AbortController().signal,
    });
    assert.ok(goalTurn.assistant_message.proposal);
    await service.confirmProposal(userA, goalTurn.assistant_message.proposal.id);
    const goals = (await pool.query(
      "SELECT daily_calories_kcal, daily_protein_g FROM goals WHERE user_id = $1",
      [userA],
    )).rows[0];
    assert.equal(goals?.daily_protein_g, "100.0000");
    assert.equal(goals?.daily_calories_kcal, null);

    planner.plans.push({
      tool: "proposeMealCreate",
      arguments_json: mealArguments("Canceled meal"),
      assistant_message: "Review this meal.",
    });
    const cancelTurn = await service.submitMessage({
      userId: userA,
      conversationId: conversation.id,
      message: "Prepare another meal.",
      signal: new AbortController().signal,
    });
    assert.ok(cancelTurn.assistant_message.proposal);
    const canceled = await service.cancelProposal(
      userA,
      cancelTurn.assistant_message.proposal.id,
    );
    assert.equal(canceled.status, "canceled");
    await assert.rejects(
      service.confirmProposal(userA, canceled.id),
      /cannot be confirmed/,
    );

    planner.plans.push({
      tool: "proposeMealCreate",
      arguments_json: mealArguments("Expired meal"),
      assistant_message: "Review this meal.",
    });
    const expiryTurn = await service.submitMessage({
      userId: userA,
      conversationId: conversation.id,
      message: "Prepare an expiring meal.",
      signal: new AbortController().signal,
    });
    assert.ok(expiryTurn.assistant_message.proposal);
    await pool.query(
      "UPDATE chat_action_proposals SET expires_at = now() - interval '1 second' WHERE id = $1",
      [expiryTurn.assistant_message.proposal.id],
    );
    await assert.rejects(
      service.confirmProposal(userA, expiryTurn.assistant_message.proposal.id),
      /expired/,
    );
    assert.equal(
      (await service.getProposal(userA, expiryTurn.assistant_message.proposal.id)).status,
      "expired",
    );

    planner.plans.push({
      tool: "proposeMealCreate",
      arguments_json: mealArguments("Confirmed in chat"),
      assistant_message: "Review this meal.",
    });
    await service.submitMessage({
      userId: userA,
      conversationId: conversation.id,
      message: "Prepare a third meal.",
      signal: new AbortController().signal,
    });
    const confirmationTurn = await service.submitMessage({
      userId: userA,
      conversationId: conversation.id,
      message: "Yes, save it.",
      signal: new AbortController().signal,
    });
    assert.match(confirmationTurn.assistant_message.content, /Confirmed/);
    assert.equal(
      (await pool.query("SELECT count(*) AS count FROM meals WHERE user_id = $1", [userA])).rows[0]?.count,
      "2",
    );
    assert.equal(
      (await pool.query("SELECT count(*) AS count FROM meals WHERE user_id = $1", [userB])).rows[0]?.count,
      "0",
    );
  } finally {
    if (owned) await rootPool.query("DROP SCHEMA " + quoted + " CASCADE");
    await rootPool.end();
  }
});
