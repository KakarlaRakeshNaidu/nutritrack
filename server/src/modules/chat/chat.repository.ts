import { timestampValue } from "../../db/values.js";
import type { DatabaseExecutor } from "../../types.js";
import {
  proposalPayloadSchema,
  type ChatPagination,
  type ProposalKind,
  type ProposalPayload,
} from "./chat.schemas.js";

export interface ChatConversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatProposal {
  id: string;
  conversation_id: string;
  message_id: string;
  kind: ProposalKind;
  version: number;
  payload: ProposalPayload;
  status: "pending" | "confirmed" | "canceled" | "expired";
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

function text(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(label + " must be text.");
  return value;
}

function integer(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new TypeError(label + " must be an integer.");
  return parsed;
}

function json(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return JSON.parse(value);
}

function mapConversation(row: Record<string, unknown>): ChatConversation {
  return {
    id: text(row.id, "Conversation id"),
    title: text(row.title, "Conversation title"),
    created_at: timestampValue(row.created_at, "Conversation created_at"),
    updated_at: timestampValue(row.updated_at, "Conversation updated_at"),
  };
}

function mapProposal(row: Record<string, unknown> | null | undefined): ChatProposal | null {
  if (
    !row ||
    row.proposal_id === null ||
    row.id === null ||
    (row.proposal_id === undefined && !("payload" in row))
  ) return null;
  const prefix = row.proposal_id !== undefined ? "proposal_" : "";
  const read = (name: string): unknown => row[prefix + name];
  const payload = proposalPayloadSchema.parse(json(read("payload")));
  const status = text(read("status"), "Proposal status");
  if (!["pending", "confirmed", "canceled", "expired"].includes(status)) {
    throw new TypeError("Proposal status is invalid.");
  }
  return {
    id: text(read("id"), "Proposal id"),
    conversation_id: text(read("conversation_id"), "Proposal conversation id"),
    message_id: text(read("message_id"), "Proposal message id"),
    kind: text(read("kind"), "Proposal kind") as ProposalKind,
    version: integer(read("version"), "Proposal version"),
    payload,
    status: status as ChatProposal["status"],
    expires_at: timestampValue(read("expires_at"), "Proposal expires_at"),
    outcome: read("outcome") === null ? null : json(read("outcome")),
    created_at: timestampValue(read("created_at"), "Proposal created_at"),
    updated_at: timestampValue(read("updated_at"), "Proposal updated_at"),
  };
}

function mapMessage(row: Record<string, unknown>): ChatMessage {
  const role = text(row.role, "Message role");
  if (role !== "user" && role !== "assistant") {
    throw new TypeError("Message role is invalid.");
  }
  return {
    id: text(row.id, "Message id"),
    conversation_id: text(row.conversation_id, "Message conversation id"),
    role,
    content: text(row.content, "Message content"),
    created_at: timestampValue(row.created_at, "Message created_at"),
    proposal: mapProposal(row),
  };
}

const PROPOSAL_JOIN_COLUMNS = [
  "p.id AS proposal_id",
  "p.conversation_id AS proposal_conversation_id",
  "p.message_id AS proposal_message_id",
  "p.kind AS proposal_kind",
  "p.version AS proposal_version",
  "p.payload AS proposal_payload",
  "p.status AS proposal_status",
  "p.expires_at AS proposal_expires_at",
  "p.outcome AS proposal_outcome",
  "p.created_at AS proposal_created_at",
  "p.updated_at AS proposal_updated_at",
].join(", ");

export async function insertConversation(
  executor: DatabaseExecutor,
  userId: string,
  title: string,
): Promise<ChatConversation> {
  const result = await executor.query({
    text: `INSERT INTO chat_conversations (user_id, title)
      VALUES ($1, $2)
      RETURNING id, title, created_at, updated_at`,
    values: [userId, title],
  });
  if (!result.rows[0]) throw new TypeError("Conversation insert returned no row.");
  return mapConversation(result.rows[0]);
}

export async function findConversation(
  executor: DatabaseExecutor,
  userId: string,
  conversationId: string,
): Promise<ChatConversation | null> {
  const result = await executor.query({
    text: `SELECT id, title, created_at, updated_at
      FROM chat_conversations WHERE id = $1 AND user_id = $2`,
    values: [conversationId, userId],
  });
  return result.rows[0] ? mapConversation(result.rows[0]) : null;
}

export async function countConversations(
  executor: DatabaseExecutor,
  userId: string,
): Promise<number> {
  const result = await executor.query({
    text: "SELECT count(*) AS count FROM chat_conversations WHERE user_id = $1",
    values: [userId],
  });
  return integer(result.rows[0]?.count ?? 0, "Conversation count");
}

export async function listConversations(
  executor: DatabaseExecutor,
  userId: string,
  pagination: ChatPagination,
): Promise<ChatConversation[]> {
  const result = await executor.query({
    text: `SELECT c.id,
      CASE WHEN c.title = 'New nutrition conversation' THEN COALESCE(
        (SELECT left(regexp_replace(m.content, '\\s+', ' ', 'g'), 64)
          FROM chat_messages m
          WHERE m.conversation_id = c.id AND m.user_id = c.user_id
            AND m.role = 'user'
          ORDER BY m.created_at ASC, m.id ASC
          LIMIT 1),
        c.title
      ) ELSE c.title END AS title,
      c.created_at, c.updated_at
      FROM chat_conversations c
      WHERE c.user_id = $1
      ORDER BY c.updated_at DESC, c.id DESC
      LIMIT $2 OFFSET $3`,
    values: [userId, pagination.page_size, (pagination.page - 1) * pagination.page_size],
  });
  return result.rows.map(mapConversation);
}

export async function setInitialConversationTitle(
  executor: DatabaseExecutor,
  userId: string,
  conversationId: string,
  title: string,
): Promise<void> {
  await executor.query({
    text: `UPDATE chat_conversations c
      SET title = $3
      WHERE c.id = $1 AND c.user_id = $2
        AND c.title = 'New nutrition conversation'
        AND NOT EXISTS (
          SELECT 1 FROM chat_messages m
          WHERE m.conversation_id = c.id AND m.user_id = c.user_id
            AND m.role = 'user'
        )`,
    values: [conversationId, userId, title],
  });
}

export async function touchConversation(
  executor: DatabaseExecutor,
  userId: string,
  conversationId: string,
): Promise<void> {
  await executor.query({
    text: "UPDATE chat_conversations SET updated_at = now() WHERE id = $1 AND user_id = $2",
    values: [conversationId, userId],
  });
}

export async function insertMessage(
  executor: DatabaseExecutor,
  input: {
    conversationId: string;
    userId: string;
    role: "user" | "assistant";
    content: string;
  },
): Promise<ChatMessage> {
  const result = await executor.query({
    text: `INSERT INTO chat_messages (conversation_id, user_id, role, content)
      SELECT c.id, c.user_id, $3, $4
      FROM chat_conversations c
      WHERE c.id = $1 AND c.user_id = $2
      RETURNING id, conversation_id, role, content, created_at`,
    values: [input.conversationId, input.userId, input.role, input.content],
  });
  if (!result.rows[0]) throw new TypeError("Message conversation was not found.");
  return mapMessage(result.rows[0]);
}

export async function countMessages(
  executor: DatabaseExecutor,
  userId: string,
  conversationId: string,
): Promise<number> {
  const result = await executor.query({
    text: `SELECT count(*) AS count
      FROM chat_messages m
      JOIN chat_conversations c ON c.id = m.conversation_id
      WHERE m.conversation_id = $1 AND c.user_id = $2`,
    values: [conversationId, userId],
  });
  return integer(result.rows[0]?.count ?? 0, "Message count");
}

export async function listMessages(
  executor: DatabaseExecutor,
  userId: string,
  conversationId: string,
  pagination: ChatPagination,
): Promise<ChatMessage[]> {
  const result = await executor.query({
    text: `SELECT m.id, m.conversation_id, m.role, m.content, m.created_at,
      ${PROPOSAL_JOIN_COLUMNS}
      FROM chat_messages m
      JOIN chat_conversations c ON c.id = m.conversation_id
      LEFT JOIN chat_action_proposals p ON p.message_id = m.id AND p.user_id = c.user_id
      WHERE m.conversation_id = $1 AND c.user_id = $2
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $3 OFFSET $4`,
    values: [
      conversationId,
      userId,
      pagination.page_size,
      (pagination.page - 1) * pagination.page_size,
    ],
  });
  return result.rows.map(mapMessage).reverse();
}

export async function recentMessages(
  executor: DatabaseExecutor,
  userId: string,
  conversationId: string,
  limit: number,
): Promise<Array<Pick<ChatMessage, "role" | "content">>> {
  const result = await executor.query({
    text: `SELECT m.role, m.content
      FROM chat_messages m
      JOIN chat_conversations c ON c.id = m.conversation_id
      WHERE m.conversation_id = $1 AND c.user_id = $2
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $3`,
    values: [conversationId, userId, limit],
  });
  return result.rows.reverse().map((row) => ({
    role: text(row.role, "Message role") as "user" | "assistant",
    content: text(row.content, "Message content"),
  }));
}

export async function insertProposal(
  executor: DatabaseExecutor,
  input: {
    conversationId: string;
    userId: string;
    messageId: string;
    payload: ProposalPayload;
    expiresAt: Date;
  },
): Promise<ChatProposal> {
  const result = await executor.query({
    text: `INSERT INTO chat_action_proposals
      (conversation_id, user_id, message_id, kind, payload, expires_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6)
      RETURNING id, conversation_id, message_id, kind, version, payload,
        status, expires_at, outcome, created_at, updated_at`,
    values: [
      input.conversationId,
      input.userId,
      input.messageId,
      input.payload.kind,
      JSON.stringify(input.payload),
      input.expiresAt,
    ],
  });
  const proposal = mapProposal(result.rows[0]);
  if (!proposal) throw new TypeError("Proposal insert returned no row.");
  return proposal;
}

export async function findProposal(
  executor: DatabaseExecutor,
  userId: string,
  proposalId: string,
  lock = false,
): Promise<ChatProposal | null> {
  const result = await executor.query({
    text: `SELECT id, conversation_id, message_id, kind, version, payload,
      status, expires_at, outcome, created_at, updated_at
      FROM chat_action_proposals
      WHERE id = $1 AND user_id = $2${lock ? " FOR UPDATE" : ""}`,
    values: [proposalId, userId],
  });
  return mapProposal(result.rows[0]);
}

export async function findActiveProposal(
  executor: DatabaseExecutor,
  userId: string,
  conversationId: string,
): Promise<ChatProposal | null> {
  const result = await executor.query({
    text: `SELECT id, conversation_id, message_id, kind, version, payload,
      status, expires_at, outcome, created_at, updated_at
      FROM chat_action_proposals
      WHERE conversation_id = $1 AND user_id = $2
        AND status = 'pending' AND expires_at > now()
      ORDER BY created_at DESC, id DESC
      LIMIT 2`,
    values: [conversationId, userId],
  });
  if (result.rows.length !== 1) return null;
  return mapProposal(result.rows[0]);
}

export async function setProposalStatus(
  executor: DatabaseExecutor,
  input: {
    userId: string;
    proposalId: string;
    status: "confirmed" | "canceled" | "expired";
    outcome?: unknown;
  },
): Promise<ChatProposal> {
  const result = await executor.query({
    text: `UPDATE chat_action_proposals
      SET status = $3, outcome = $4::jsonb, updated_at = now()
      WHERE id = $1 AND user_id = $2
      RETURNING id, conversation_id, message_id, kind, version, payload,
        status, expires_at, outcome, created_at, updated_at`,
    values: [
      input.proposalId,
      input.userId,
      input.status,
      input.outcome === undefined ? null : JSON.stringify(input.outcome),
    ],
  });
  const proposal = mapProposal(result.rows[0]);
  if (!proposal) throw new TypeError("Proposal update returned no row.");
  return proposal;
}
