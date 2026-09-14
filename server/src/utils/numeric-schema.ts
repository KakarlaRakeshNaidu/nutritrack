import { z } from "zod";

export function hasAtMostFourDecimalPlaces(value: number): boolean {
  const [coefficient, exponentText = "0"] = String(value).toLowerCase().split("e");
  const fractionLength = coefficient.split(".")[1]?.length ?? 0;
  const exponent = Number(exponentText);

  return Math.max(0, fractionLength - exponent) <= 4;
}

export function boundedNumericSchema(
  { positive = false }: { positive?: boolean } = {},
) {
  let schema = z
    .number()
    .finite()
    .max(1_000_000)
    .refine(hasAtMostFourDecimalPlaces, {
      message: "Must have at most four decimal places.",
    });

  schema = positive ? schema.positive() : schema.nonnegative();
  return schema;
}
