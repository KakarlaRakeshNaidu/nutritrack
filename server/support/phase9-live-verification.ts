import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import sharp from "sharp";
import request from "supertest";

import { createApp } from "../src/app.js";
import {
  discoverMigrations,
  quoteInternalIdentifier,
  runMigrations,
} from "../src/db/migration-runner.js";
import {
  createDatabasePool,
  MIGRATION_STATEMENT_TIMEOUT_MS,
  verifyDatabaseConnection,
} from "../src/db/pool.js";
import { createGeminiAdapter } from "../src/modules/nutrition/gemini.adapter.js";
import { extractionResultSchema } from "../src/modules/nutrition/nutrition.schemas.js";
import { createExtractionService } from "../src/modules/nutrition/nutrition.service.js";
import type { ProviderAdapter } from "../src/modules/nutrition/provider-common.js";
import type { DatabasePool } from "../src/types.js";
import { recordingLogger } from "./testing.js";
import { loadDatabaseTestConfig } from "../tests-db/database-test-config.js";

const tables = [
  { name: "tracker_profile", orderBy: "id" },
  { name: "goals", orderBy: "id" },
  { name: "meals", orderBy: "id" },
  { name: "schema_migrations", orderBy: "version" },
] as const;

type Snapshot = Record<string, { exists: boolean; rows?: number | null; digest?: string }>;

function counted(adapter: ProviderAdapter, calls: { count: number }): ProviderAdapter {
  return {
    name: adapter.name,
    async analyze(input) {
      calls.count += 1;
      return adapter.analyze(input);
    },
  };
}

function schemaPool(base: DatabasePool, schema: string): DatabasePool {
  const quoted = quoteInternalIdentifier(schema);
  return {
    async connect() {
      const client = await base.connect();
      try {
        await client.query("SELECT set_config('search_path', $1, false)", [quoted]);
        return client;
      } catch (error) {
        client.release(error instanceof Error ? error : undefined);
        throw error;
      }
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

async function snapshot(pool: DatabasePool, schema: string): Promise<Snapshot> {
  const result: Snapshot = {};
  const quotedSchema = quoteInternalIdentifier(schema);
  for (const table of tables) {
    const exists = await pool.query("SELECT to_regclass($1) AS relation", [
      schema + "." + table.name,
    ]);
    if (exists.rows[0]?.relation === null) {
      result[table.name] = { exists: false };
      continue;
    }
    const rows = await pool.query(
      `SELECT * FROM ${quotedSchema}."${table.name}" ORDER BY "${table.orderBy}"`,
    );
    result[table.name] = {
      exists: true,
      rows: rows.rowCount,
      digest: createHash("sha256").update(JSON.stringify(rows.rows)).digest("hex"),
    };
  }
  return result;
}

async function labelImage(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500">
    <rect width="1200" height="1500" fill="white"/>
    <rect x="50" y="50" width="1100" height="1400" fill="none" stroke="black" stroke-width="12"/>
    <g font-family="Arial, sans-serif" fill="black">
      <text x="90" y="150" font-size="90" font-weight="700">Nutrition Facts</text>
      <line x1="90" y1="190" x2="1110" y2="190" stroke="black" stroke-width="18"/>
      <text x="90" y="270" font-size="46">Serving size 100 g</text>
      <line x1="90" y1="310" x2="1110" y2="310" stroke="black" stroke-width="10"/>
      <text x="90" y="420" font-size="54" font-weight="700">Amount per serving</text>
      <text x="90" y="545" font-size="86" font-weight="700">Calories</text>
      <text x="870" y="545" font-size="86" font-weight="700">250</text>
      <line x1="90" y1="590" x2="1110" y2="590" stroke="black" stroke-width="12"/>
      <text x="90" y="700" font-size="54" font-weight="700">Total Fat 8 g</text>
      <line x1="90" y1="730" x2="1110" y2="730" stroke="black" stroke-width="3"/>
      <text x="90" y="835" font-size="54" font-weight="700">Total Carbohydrate 30 g</text>
      <line x1="90" y1="865" x2="1110" y2="865" stroke="black" stroke-width="3"/>
      <text x="90" y="970" font-size="54" font-weight="700">Protein 10 g</text>
      <line x1="90" y1="1000" x2="1110" y2="1000" stroke="black" stroke-width="10"/>
      <text x="90" y="1110" font-size="54">Sodium 400 mg</text>
      <line x1="90" y1="1140" x2="1110" y2="1140" stroke="black" stroke-width="3"/>
      <text x="90" y="1250" font-size="42">Values are for one 100 g serving.</text>
    </g>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main(): Promise<void> {
  const config = await loadDatabaseTestConfig();
  const geminiState = config.providers.gemini;
  assert.equal(geminiState.status, "configured", "Gemini live configuration is required.");
  if (geminiState.status !== "configured") {
    return;
  }

  const logger = recordingLogger();
  const base = await createDatabasePool(config, {
    statementTimeoutMillis: MIGRATION_STATEMENT_TIMEOUT_MS,
    logger,
  });
  const schema = "nutritrack_p9_" + process.pid + "_" +
    randomUUID().replaceAll("-", "").slice(0, 12);
  const quotedSchema = quoteInternalIdentifier(schema);
  let schemaOwned = false;
  let publicBefore: Snapshot | undefined;
  let primaryError: unknown;

  try {
    await verifyDatabaseConnection(base);
    publicBefore = await snapshot(base, "public");
    await base.query("CREATE SCHEMA " + quotedSchema);
    schemaOwned = true;
    const isolated = schemaPool(base, schema);
    const migrations = await discoverMigrations(new URL("../migrations/", import.meta.url));
    await runMigrations({ pool: isolated, migrations, schema, logger });
    const isolatedBefore = await snapshot(base, schema);

    const geminiCalls = { count: 0 };
    const realGemini = counted(createGeminiAdapter(geminiState), geminiCalls);
    const realService = createExtractionService({
      pool: isolated,
      providers: config.providers,
      gemini: realGemini,
    });
    const app = createApp(config, {
      pool: isolated,
      extractionService: realService,
      logger,
    });

    const label = await labelImage();
    const labelStarted = performance.now();
    const labelResponse = await request(app)
      .post("/api/v1/nutrition/extract")
      .field("image_type", "nutrition_label")
      .attach("image", label, { filename: "synthetic-label.png", contentType: "image/png" });
    const labelMs = Math.round(performance.now() - labelStarted);
    assert.equal(labelResponse.status, 200, labelResponse.body?.error?.code);
    const labelResult = extractionResultSchema.parse(labelResponse.body.data);
    assert.equal(labelResult.provider, "gemini");
    assert.equal(labelResult.draft.consumed_quantity, 100);
    assert.equal(labelResult.draft.quantity_unit, "g");
    assert.equal(labelResult.draft.calories_kcal, 250);
    assert.equal(labelResult.draft.protein_g, 10);
    assert.equal(labelResult.draft.carbs_g, 30);
    assert.equal(labelResult.draft.fat_g, 8);
    assert.equal(labelResult.is_estimate, false);
    assert.deepEqual(await snapshot(base, schema), isolatedBefore);

    const plate = await readFile(new URL("./fixtures/phase9-live-plate.png", import.meta.url));
    const plateStarted = performance.now();
    const plateResponse = await request(app)
      .post("/api/v1/nutrition/extract")
      .field("image_type", "food_plate")
      .attach("image", plate, { filename: "permitted-plate.png", contentType: "image/png" });
    const plateMs = Math.round(performance.now() - plateStarted);
    assert.equal(plateResponse.status, 200, plateResponse.body?.error?.code);
    const plateResult = extractionResultSchema.parse(plateResponse.body.data);
    assert.equal(plateResult.provider, "gemini");
    assert.equal(plateResult.is_estimate, true);
    assert.equal(plateResult.draft.entry_source, "food_plate");
    assert.equal(plateResult.draft.is_estimate, true);
    assert(plateResult.assumptions.length > 0);
    assert.deepEqual(await snapshot(base, schema), isolatedBefore);

    const failedResponse = await request(app)
      .post("/api/v1/nutrition/extract")
      .field("image_type", "nutrition_label")
      .attach("image", Buffer.from("not-an-image"), {
        filename: "invalid.png",
        contentType: "image/png",
      });
    assert.equal(failedResponse.status, 422);
    assert.equal(failedResponse.body.error.code, "IMAGE_INVALID");
    assert.deepEqual(await snapshot(base, schema), isolatedBefore);

    assert.equal(geminiCalls.count, 2);
    assert.deepEqual(await snapshot(base, schema), isolatedBefore);
    assert.deepEqual(await snapshot(base, "public"), publicBefore);

    console.log("PHASE9_LIVE_RESULT=" + JSON.stringify({
      outbound_calls: { gemini: geminiCalls.count },
      models: {
        gemini: geminiState.model,
      },
      label: {
        status: labelResponse.status,
        duration_ms: labelMs,
        quantity: labelResult.draft.consumed_quantity,
        quantity_unit: labelResult.draft.quantity_unit,
        calories_kcal: labelResult.draft.calories_kcal,
        protein_g: labelResult.draft.protein_g,
        carbs_g: labelResult.draft.carbs_g,
        fat_g: labelResult.draft.fat_g,
      },
      plate: {
        status: plateResponse.status,
        duration_ms: plateMs,
        assumptions: plateResult.assumptions.length,
      },
      no_persistence: true,
      ordinary_public_data_unchanged: true,
    }));
  } catch (error) {
    primaryError = error;
  } finally {
    if (schemaOwned) {
      await base.query("DROP SCHEMA " + quotedSchema + " CASCADE");
    }
    if (publicBefore) {
      assert.deepEqual(await snapshot(base, "public"), publicBefore);
    }
    await base.end();
  }

  if (primaryError) {
    throw primaryError;
  }
}

main().catch((error: unknown) => {
  const safe = error instanceof Error ? `${error.name}: ${error.message}` : "Unknown live-check failure";
  console.error("PHASE9_LIVE_FAILURE=" + safe);
  process.exitCode = 1;
});
