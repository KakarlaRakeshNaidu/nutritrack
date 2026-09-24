import type { ErrorDetail } from "../types";

interface ApiErrorOptions {
  code?: string;
  message?: string;
  details?: ErrorDetail[];
  requestId?: string | null;
  retryAfter?: string | null;
  ambiguous?: boolean;
  status?: number | null;
}

export interface ApiRequestOptions {
  method?: string;
  body?: unknown;
  ambiguousOnNetworkError?: boolean;
  signal?: AbortSignal;
}

function isAbortError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "AbortError",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

const DEVELOPMENT_API_BASE_URL = "http://localhost:3000/api/v1";

export function resolveApiBaseUrl({
  production,
  configured,
  hostname,
}: {
  production: boolean;
  configured?: string;
  hostname?: string;
}): string {
  const isLoopback = hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1";

  // Hosted production uses the same-origin proxy so the HttpOnly session
  // cookie remains first-party. Local previews may still target a local API.
  if (production && !isLoopback) return "/api/v1";
  return (configured?.trim() || DEVELOPMENT_API_BASE_URL).replace(/\/+$/, "");
}

export class ApiError extends Error {
  readonly code: string;
  readonly details: ErrorDetail[];
  readonly requestId: string | null;
  readonly ambiguous: boolean;
  readonly retryAfter: string | null;
  readonly status: number | null;

  constructor({
    code = "REQUEST_FAILED",
    message = "The request could not be completed.",
    details = [],
    requestId = null,
    ambiguous = false,
    retryAfter = null,
    status = null,
  }: ApiErrorOptions = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = Array.isArray(details) ? details : [];
    this.requestId = requestId;
    this.ambiguous = ambiguous;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function apiBaseUrl(): string {
  return resolveApiBaseUrl({
    production: import.meta.env.PROD,
    configured: import.meta.env.VITE_API_BASE_URL,
    hostname: window.location.hostname,
  });
}

function safeErrorEnvelope(
  payload: unknown,
  status: number,
  requestId: string | null,
  retryAfter: string | null,
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
    retryAfter,
  });
}

export async function apiRequest<ResponseBody = unknown>(
  path: string,
  { method = "GET", body, signal, ambiguousOnNetworkError }: ApiRequestOptions = {},
): Promise<ResponseBody> {
  const hasBody = body !== undefined;
  const multipart = body instanceof FormData;
  const requestOptions: RequestInit = {
    method,
    signal,
    credentials: "include",
    headers:
      hasBody && !multipart ? { "Content-Type": "application/json" } : undefined,
    // FormData must reach fetch unchanged so the browser creates the boundary.
    body: hasBody ? (multipart ? body : JSON.stringify(body)) : undefined,
  };

  let response: Response;
  try {
    // Mutations are deliberately attempted once. Retrying after a transport
    // failure could duplicate a create or repeat a confirmed user action.
    response = await fetch(apiBaseUrl() + path, requestOptions);
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    throw new ApiError({
      code: "NETWORK_ERROR",
      ambiguous: ambiguousOnNetworkError ?? method !== "GET",
      message:
        (ambiguousOnNetworkError ?? method !== "GET") === false
          ? "Could not reach the server. Check your connection and try again."
          : "Could not confirm the save. Check history before submitting again.",
    });
  }

  if (response.status === 401) {
    window.dispatchEvent(new Event("nutritrack:unauthorized"));
  }

  if (response.status === 204) {
    return null as ResponseBody;
  }

  const requestId = response.headers.get("x-request-id");
  const contentType = response.headers.get("content-type") ?? "";
  const retryAfter = response.headers.get("retry-after");
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
    throw safeErrorEnvelope(payload, response.status, requestId, retryAfter);
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
