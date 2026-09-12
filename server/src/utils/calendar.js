const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MILLISECONDS_PER_DAY = 86_400_000;
const MINIMUM_YEAR = 1900;
const MAXIMUM_YEAR = 9999;

function buildUtcDate(year, month, day) {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

function parseCalendarDate(value) {
  const match = typeof value === "string" ? DATE_PATTERN.exec(value) : null;

  if (!match) {
    throw new RangeError("Expected a calendar date in YYYY-MM-DD format.");
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = buildUtcDate(year, month, day);

  if (
    year < MINIMUM_YEAR ||
    year > MAXIMUM_YEAR ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError("Expected a real calendar date from 1900 through 9999.");
  }

  return date;
}

function formatCalendarDate(date) {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isValidCalendarDate(value) {
  try {
    parseCalendarDate(value);
    return true;
  } catch {
    return false;
  }
}

export function compareCalendarDates(left, right) {
  parseCalendarDate(left);
  parseCalendarDate(right);
  return left.localeCompare(right);
}

export function addCalendarDays(value, amount) {
  if (!Number.isInteger(amount)) {
    throw new TypeError("Calendar-day arithmetic requires an integer amount.");
  }

  // UTC is used only as an arithmetic container. The diary value remains a
  // calendar date and is never reinterpreted as a consumption timestamp.
  const date = parseCalendarDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  const result = formatCalendarDate(date);

  if (!isValidCalendarDate(result)) {
    throw new RangeError("Calendar arithmetic exceeded the supported date range.");
  }

  return result;
}

export function inclusiveDayCount(startDate, endDate) {
  const start = parseCalendarDate(startDate);
  const end = parseCalendarDate(endDate);

  if (start > end) {
    throw new RangeError("Start date must not be after end date.");
  }

  // Both endpoints count because diary and report range contracts are inclusive.
  return Math.round((end - start) / MILLISECONDS_PER_DAY) + 1;
}

export function getWeekBounds(value) {
  const date = parseCalendarDate(value);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  const weekStart = addCalendarDays(value, -daysSinceMonday);

  return {
    weekStart,
    weekEnd: addCalendarDays(weekStart, 6),
  };
}

export function getTodayInTimeZone(instant, timeZone) {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new TypeError("A valid instant is required.");
  }

  if (typeof timeZone !== "string" || timeZone.trim().length === 0) {
    throw new RangeError("A valid IANA timezone is required.");
  }

  let formatter;

  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    throw new RangeError("A valid IANA timezone is required.");
  }

  // Explicit date parts avoid locale-formatted strings and ensure the supplied
  // IANA timezone, rather than the host process timezone, defines “today”.
  const parts = Object.fromEntries(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const today = `${parts.year}-${parts.month}-${parts.day}`;

  if (!isValidCalendarDate(today)) {
    throw new RangeError("Timezone conversion exceeded the supported date range.");
  }

  return today;
}

export function isConsumptionDateAllowed(consumptionDate, capturedToday) {
  // Future dates are valid report bounds, but a consumed meal cannot be saved
  // after the one authoritative today captured for its operation.
  return compareCalendarDates(consumptionDate, capturedToday) <= 0;
}
