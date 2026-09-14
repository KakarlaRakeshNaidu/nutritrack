import type { ReportBucket, ReportGrouping } from "../types";

const amountFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 4,
});

export function formatAmount(value: number): string {
  return amountFormatter.format(Object.is(value, -0) ? 0 : value);
}

export function formatPercent(value: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Object.is(value, -0) ? 0 : value) + "%";
}

export function bucketLabel(
  bucket: ReportBucket,
  grouping: ReportGrouping,
): string {
  if (grouping === "day") {
    return bucket.covered_start;
  }
  return bucket.period_start + " to " + bucket.period_end;
}

export function bucketCoverage(bucket: ReportBucket): string {
  if (
    bucket.covered_start === bucket.period_start &&
    bucket.covered_end === bucket.period_end
  ) {
    return "Full week";
  }
  return "Covered " + bucket.covered_start + " to " + bucket.covered_end;
}

export function bucketStatus(bucket: ReportBucket): string {
  if (bucket.temporal_state === "future") {
    return "Future";
  }
  if (bucket.entry_count === 0) {
    return "No meals logged";
  }
  return bucket.entry_count + (bucket.entry_count === 1 ? " meal" : " meals");
}
