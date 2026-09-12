export class AppError extends Error {
  constructor({ status, code, message, details = [] }) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function issueDetails(issue) {
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

export function requestValidationError(zodError) {
  return new AppError({
    status: 422,
    code: "VALIDATION_ERROR",
    message: "Please correct the highlighted fields.",
    details: zodError.issues.flatMap(issueDetails),
  });
}
