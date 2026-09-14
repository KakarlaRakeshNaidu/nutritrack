import type { ZodError, ZodIssue } from "zod";

export interface ErrorDetail {
  field: string;
  message: string;
}

interface AppErrorOptions {
  status: number;
  code: string;
  message: string;
  details?: ErrorDetail[];
}

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ErrorDetail[];

  constructor({ status, code, message, details = [] }: AppErrorOptions) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function issueDetails(issue: ZodIssue): ErrorDetail[] {
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) => ({
      field: [...issue.path, key].join("."),
      message: "Unknown field.",
    }));
  }

  return [
    {
      field: issue.path.join("."),
      message: issue.message,
    },
  ];
}

export function requestValidationError(zodError: ZodError): AppError {
  return new AppError({
    status: 422,
    code: "VALIDATION_ERROR",
    message: "Please correct the highlighted fields.",
    details: zodError.issues.flatMap(issueDetails),
  });
}
