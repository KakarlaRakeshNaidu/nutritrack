import { z } from "zod";

const DECIMAL_PATTERN = /^(?:\d+\.?\d*|\.\d+)$/;

export function numericInput({
  label,
  nullable = false,
  positive = false,
}: {
  label: string;
  nullable?: boolean;
  positive?: boolean;
}) {
  return z
    .string()
    .trim()
    .superRefine((value, context) => {
      if (value === "") {
        if (!nullable) {
          context.addIssue({
            code: "custom",
            message: label + " is required.",
          });
        }
        return;
      }
      if (!DECIMAL_PATTERN.test(value)) {
        context.addIssue({
          code: "custom",
          message: label + " must be a number.",
        });
        return;
      }

      const fraction = value.split(".")[1] ?? "";
      if (fraction.length > 4) {
        context.addIssue({
          code: "custom",
          message: label + " must have at most four decimal places.",
        });
        return;
      }

      const number = Number(value);
      if (!Number.isFinite(number) || number > 1_000_000) {
        context.addIssue({
          code: "custom",
          message: label + " must be no greater than 1,000,000.",
        });
      } else if (positive ? number <= 0 : number < 0) {
        context.addIssue({
          code: "custom",
          message: positive
            ? label + " must be greater than zero."
            : label + " cannot be negative.",
        });
      }
    })
    .transform((value) => {
      // Blank nullable controls represent unknown/unset, whereas the visible
      // string "0" intentionally survives as numeric zero.
      if (nullable && value === "") {
        return null;
      }
      return Number(value);
    });
}
