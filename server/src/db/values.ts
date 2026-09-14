export function numericValue(value: unknown, label = "Persisted numeric value"): number | null {
  if (value === null) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(label + " must be finite.");
  }
  return parsed;
}

export function timestampValue(value: unknown, label = "Persisted timestamp"): string {
  const timestamp =
    value instanceof Date || typeof value === "string" || typeof value === "number"
      ? new Date(value)
      : new Date(Number.NaN);
  if (Number.isNaN(timestamp.getTime())) {
    throw new TypeError(label + " must be valid.");
  }
  return timestamp.toISOString();
}
