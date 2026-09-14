export type ProviderFailureKind =
  | "unavailable"
  | "output_invalid"
  | "configuration"
  | "content"
  | "application_bug"
  | "user_cancellation";

export class ProviderFailure extends Error {
  readonly kind: ProviderFailureKind;
  readonly contentStatus?: "unreadable" | "not_food" | "refused";

  constructor(
    kind: ProviderFailureKind,
    message: string,
    options: {
      cause?: unknown;
      contentStatus?: "unreadable" | "not_food" | "refused";
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ProviderFailure";
    this.kind = kind;
    this.contentStatus = options.contentStatus;
  }
}

export function cancellationFailure(cause?: unknown): ProviderFailure {
  return new ProviderFailure("user_cancellation", "Extraction was canceled.", {
    cause,
  });
}
