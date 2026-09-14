import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

import {
  addCalendarDays,
  compareCalendarDates,
  getTodayInTimeZone,
  getWeekBounds,
  inclusiveDayCount,
  isConsumptionDateAllowed,
  isValidCalendarDate,
} from "../src/utils/calendar.js";

const execFileAsync = promisify(execFile);

test("strict validation accepts real leap dates and rejects rollover dates", () => {
  assert.equal(isValidCalendarDate("2024-02-29"), true);

  for (const value of [
    "2025-02-29",
    "2026-02-30",
    "2026-13-01",
    "2026-9-01",
    "not-a-date",
    "1899-12-31",
    "10000-01-01",
  ]) {
    assert.equal(isValidCalendarDate(value), false);
  }
});

test("date comparison and inclusive range length retain both endpoints", () => {
  assert.equal(compareCalendarDates("2026-09-12", "2026-09-12"), 0);
  assert.equal(inclusiveDayCount("2026-09-12", "2026-09-12"), 1);
  assert.equal(inclusiveDayCount("2026-09-07", "2026-09-13"), 7);
  assert.throws(
    () => inclusiveDayCount("2026-09-13", "2026-09-07"),
    /Start date must not be after end date/,
  );
});

test("calendar arithmetic handles leap, month, and year transitions", () => {
  assert.equal(addCalendarDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addCalendarDays("2024-02-29", 1), "2024-03-01");
  assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addCalendarDays("2026-01-01", -1), "2025-12-31");
  assert.throws(() => addCalendarDays("9999-12-31", 1), /supported date range/);
});

test("week bounds use Monday through Sunday", () => {
  assert.deepEqual(getWeekBounds("2026-09-13"), {
    weekStart: "2026-09-07",
    weekEnd: "2026-09-13",
  });
  assert.deepEqual(getWeekBounds("2026-09-14"), {
    weekStart: "2026-09-14",
    weekEnd: "2026-09-20",
  });
});

test("an injected instant derives today from the explicit IANA timezone", () => {
  const instant = new Date("2026-09-12T20:00:00Z");

  assert.equal(getTodayInTimeZone(instant, "Asia/Kolkata"), "2026-09-13");
  assert.equal(getTodayInTimeZone(instant, "UTC"), "2026-09-12");
  assert.throws(
    () => getTodayInTimeZone(instant, "Not/A_Timezone"),
    /valid IANA timezone/,
  );
  assert.throws(() => getTodayInTimeZone(instant, ""), /valid IANA timezone/);
  assert.throws(() => getTodayInTimeZone(instant), /valid IANA timezone/);
});

test("consumption dates reject the future without restricting query ranges", () => {
  const today = "2026-09-12";

  assert.equal(isConsumptionDateAllowed("2026-09-12", today), true);
  assert.equal(isConsumptionDateAllowed("2026-09-13", today), false);
  assert.equal(inclusiveDayCount("2026-09-12", "2026-09-13"), 2);
});

test("explicit timezone results do not depend on process TZ", async () => {
  const script = [
    "import { getTodayInTimeZone } from './src/utils/calendar.js';",
    "console.log(getTodayInTimeZone(new Date('2026-09-12T20:00:00Z'), 'Asia/Kolkata'));",
  ].join(" ");
  const cwd = new URL("..", import.meta.url);
  const results = await Promise.all(
    ["UTC", "America/Los_Angeles"].map(async (TZ) => {
      const { stdout } = await execFileAsync(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "--eval", script],
        { cwd, env: { ...process.env, TZ }, timeout: 2_000 },
      );
      return stdout.trim();
    }),
  );

  assert.deepEqual(results, ["2026-09-13", "2026-09-13"]);
});
