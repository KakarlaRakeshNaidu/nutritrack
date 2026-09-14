import type { ErrorDetail } from "../types";

interface ApiErrorOptions {
  code?: string;
  message?: string;
  details?: ErrorDetail[];
  requestId?: string | null;
  ambiguous?: boolean;
  status?: number | null;
}

export interface ApiRequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

const DEFAULT_API_BASE_URL = "http://localhost:3000/api/v1";

export class ApiError extends Error {
  readonly code: string;
  readonly details: ErrorDetail[];
  readonly requestId: string | null;
  readonly ambiguous: boolean;
  readonly status: number | null;

  constructor({
    code = "REQUEST_FAILED",
    message = "The request could not be completed.",
    details = [],
    requestId = null,
    ambiguous = false,
    status = null,
  }: ApiErrorOptions = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = Array.isArray(details) ? details : [];
    this.requestId = requestId;
    this.ambiguous = ambiguous;
    this.status = status;
  }
}

function apiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  return (configured || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

function safeErrorEnvelope(
  payload: unknown,
  status: number,
  requestId: string | null,
): ApiError {
  const source =
    isRecord(payload) && isRecord(payload.error)
      ? payload.error
      : {};
  return new ApiError({
    status,
    code: typeof source.code === "string" ? source.code : "REQUEST_FAILED",
    message:
      typeof source.message === "string"
        ? source.message
        : "The server could not complete the request.",
    details: Array.isArray(source.details)
      ? source.details.filter(
          (detail): detail is ErrorDetail =>
            isRecord(detail) &&
            typeof detail.field === "string" &&
            typeof detail.message === "string",
        )
      : [],
    requestId:
      typeof source.request_id === "string"
        ? source.request_id
        : (requestId ?? null),
  });
}

export async function apiRequest<ResponseBody = unknown>(
  path: string,
  { method = "GET", body, signal }: ApiRequestOptions = {},
): Promise<ResponseBody> {
  const hasBody = body !== undefined;
  const requestOptions: RequestInit = {
    method,
    signal,
    headers: hasBody ? { "Content-Type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(body) : undefined,
  };

  let response: Response;
  try {
    // Mutations are deliberately attempted once. Retrying after a transport
    // failure could duplicate a create or repeat a confirmed user action.
    response = await fetch(apiBaseUrl() + path, requestOptions);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }

    throw new ApiError({
      code: "NETWORK_ERROR",
      ambiguous: method !== "GET",
      message:
        method === "GET"
          ? "Could not reach the server. Check your connection and try again."
          : "Could not confirm the save. Check history before submitting again.",
    });
  }

  if (response.status === 204) {
    return null as ResponseBody;
  }

  const requestId = response.headers.get("x-request-id");
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ApiError({
      status: response.status,
      code: response.ok ? "INVALID_RESPONSE" : "REQUEST_FAILED",
      message: "The server returned an unexpected response.",
      requestId,
    });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError({
      status: response.status,
      code: "INVALID_RESPONSE",
      message: "The server returned an unreadable response.",
      requestId,
    });
  }

  if (!response.ok) {
    throw safeErrorEnvelope(payload, response.status, requestId);
  }

  return payload as ResponseBody;
}

export function queryString<Parameters extends object>(
  parameters: Parameters,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const serialized = search.toString();
  return serialized ? "?" + serialized : "";
}
