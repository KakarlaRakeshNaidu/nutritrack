import type { ReactNode } from "react";

export function LoadingState({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="state-card" role="status" aria-live="polite">
      <span className="loading-dot" aria-hidden="true" />
      {message}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="state-card empty-state">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </section>
  );
}

export function ErrorMessage({
  error,
  onRetry,
  title = "Something went wrong",
}: {
  error: { message: string; requestId?: string | null } | null;
  onRetry?: () => void;
  title?: string;
}) {
  if (!error) {
    return null;
  }

  return (
    <section className="state-card error-state" role="alert">
      <h2>{title}</h2>
      <p>{error.message}</p>
      {error.requestId && (
        <p className="request-id">Request ID: {error.requestId}</p>
      )}
      {onRetry && (
        <button className="button secondary" type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </section>
  );
}

export function StatusMessage({
  children,
  tone = "success",
}: {
  children?: ReactNode;
  tone?: "success" | "error" | "neutral";
}) {
  if (!children) {
    return null;
  }

  return (
    <p className={"status-message " + tone} role="status" aria-live="polite">
      {children}
    </p>
  );
}
