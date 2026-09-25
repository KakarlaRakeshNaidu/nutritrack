import type { MealPayload, Pagination } from "../types";
import { apiRequest, queryString } from "./client";

export interface ChatConversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export type ChatProposalStatus =
  | "pending"
  | "confirmed"
  | "canceled"
  | "expired";

export interface ChatProposal {
  id: string;
  conversation_id: string;
  message_id: string;
  kind: "meal_create" | "meal_update" | "meal_delete" | "goals_replace";
  version: number;
  payload: Record<string, unknown>;
  status: ChatProposalStatus;
  expires_at: string;
  outcome: unknown | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  proposal: ChatProposal | null;
}

export interface ChatTurn {
  user_message: ChatMessage;
  assistant_message: ChatMessage;
}

interface Page<T> {
  items: T[];
  pagination: Pagination;
}

export async function createConversation(
  title?: string,
): Promise<ChatConversation> {
  const response = await apiRequest<{ data: ChatConversation }>(
    "/chat/conversations",
    { method: "POST", body: title ? { title } : {} },
  );
  return response.data;
}

export function listConversations(
  page = 1,
  pageSize = 20,
  signal?: AbortSignal,
): Promise<Page<ChatConversation>> {
  return apiRequest("/chat/conversations" + queryString({
    page,
    page_size: pageSize,
  }), { signal });
}

export function listChatMessages(
  conversationId: string,
  page = 1,
  pageSize = 20,
  signal?: AbortSignal,
): Promise<Page<ChatMessage>> {
  return apiRequest(
    "/chat/conversations/" + encodeURIComponent(conversationId) +
      "/messages" + queryString({ page, page_size: pageSize }),
    { signal },
  );
}

export async function submitChatMessage(
  conversationId: string,
  message: string,
  signal?: AbortSignal,
): Promise<ChatTurn> {
  const response = await apiRequest<{ data: ChatTurn }>(
    "/chat/conversations/" + encodeURIComponent(conversationId) + "/messages",
    {
      method: "POST",
      body: { message },
      signal,
      ambiguousOnNetworkError: false,
    },
  );
  return response.data;
}

export async function createImageMealProposal(
  conversationId: string,
  meal: MealPayload,
  assumptions: string[],
): Promise<ChatMessage> {
  const response = await apiRequest<{ data: ChatMessage }>(
    "/chat/conversations/" + encodeURIComponent(conversationId) +
      "/image-proposals",
    {
      method: "POST",
      body: { meal, assumptions },
    },
  );
  return response.data;
}

export async function getChatProposal(id: string): Promise<ChatProposal> {
  const response = await apiRequest<{ data: ChatProposal }>(
    "/chat/proposals/" + encodeURIComponent(id),
  );
  return response.data;
}

export async function confirmChatProposal(id: string): Promise<ChatProposal> {
  const response = await apiRequest<{ data: ChatProposal }>(
    "/chat/proposals/" + encodeURIComponent(id) + "/confirm",
    { method: "POST" },
  );
  return response.data;
}

export async function cancelChatProposal(id: string): Promise<ChatProposal> {
  const response = await apiRequest<{ data: ChatProposal }>(
    "/chat/proposals/" + encodeURIComponent(id) + "/cancel",
    { method: "POST" },
  );
  return response.data;
}
