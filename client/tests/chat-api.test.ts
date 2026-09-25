import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  confirmChatProposal,
  createConversation,
  listChatMessages,
  submitChatMessage,
} from "../src/api/chat";

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("chat API client", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_BASE_URL", "http://api.example.test/api/v1");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("uses bounded message pagination and encoded conversation ids", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      items: [],
      pagination: {
        page: 2,
        page_size: 20,
        total_items: 30,
        total_pages: 2,
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await listChatMessages("conversation/id", 2, 20);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://api.example.test/api/v1/chat/conversations/conversation%2Fid/messages?page=2&page_size=20",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "GET",
      credentials: "include",
    });
  });

  it("submits a chat turn once and never retries confirmations", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({
        data: {
          user_message: { id: "u" },
          assistant_message: { id: "a" },
        },
      }))
      .mockResolvedValueOnce(response({
        data: {
          id: "proposal-id",
          status: "confirmed",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await submitChatMessage("conversation-id", "Yes, save it.");
    await confirmChatProposal("proposal-id");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ message: "Yes, save it." }),
    });
    expect(fetchMock.mock.calls[1][0]).toBe(
      "http://api.example.test/api/v1/chat/proposals/proposal-id/confirm",
    );
  });

  it("creates a conversation only after an explicit request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      data: {
        id: "conversation-id",
        title: "New nutrition conversation",
        created_at: "2026-09-24T00:00:00.000Z",
        updated_at: "2026-09-24T00:00:00.000Z",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    expect(fetchMock).not.toHaveBeenCalled();
    await createConversation();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
