import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import {
  cancelChatProposal,
  confirmChatProposal,
  createConversation,
  createImageMealProposal,
  getChatProposal,
  listChatMessages,
  listConversations,
  submitChatMessage,
  type ChatConversation,
  type ChatMessage,
  type ChatProposal,
} from "../api/chat";
import { ApiError } from "../api/client";
import { extractNutrition } from "../api/nutrition";
import { getProfile } from "../api/profile";
import { useAuth } from "../auth/AuthContext";
import {
  ACCEPTED_IMAGE_TYPES,
  validateImageFile,
} from "../components/ImagePicker";
import { MealForm } from "../components/MealForm";
import type {
  ExtractionResult,
  ImageType,
  MealPayload,
  Profile,
} from "../types";
import {
  extractionToFormValues,
  type MealFormInput,
} from "../validation/meals";

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Your session ended. Sign in again.";
    if (error.status === 403) return "This action is not allowed for this session.";
    if (error.status === 429) return "Chat is busy or rate limited. Wait before trying again.";
    if ([502, 503, 504].includes(error.status ?? 0)) {
      return "Gemini is temporarily unavailable. Your saved diary was not changed.";
    }
    return error.message;
  }
  return "The request could not be completed.";
}

function proposalLabel(proposal: ChatProposal): string {
  switch (proposal.kind) {
    case "meal_create":
      return "Create meal";
    case "meal_update":
      return "Update meal";
    case "meal_delete":
      return "Delete meal";
    case "goals_replace":
      return "Replace goals";
  }
}

function ProposalCard({
  proposal,
  disabled,
  onChange,
}: {
  proposal: ChatProposal;
  disabled: boolean;
  onChange(proposal: ChatProposal): void;
}) {
  const [pending, setPending] = useState<"confirm" | "cancel" | null>(null);
  const [failure, setFailure] = useState("");

  async function act(action: "confirm" | "cancel") {
    if (pending || proposal.status !== "pending") return;
    setPending(action);
    setFailure("");
    try {
      const result = action === "confirm"
        ? await confirmChatProposal(proposal.id)
        : await cancelChatProposal(proposal.id);
      onChange(result);
    } catch (error) {
      if (action === "confirm" && error instanceof ApiError && error.ambiguous) {
        try {
          const current = await getChatProposal(proposal.id);
          onChange(current);
          if (current.status === "confirmed") return;
        } catch {
          // The original error remains the clearest recovery guidance.
        }
      }
      setFailure(errorMessage(error));
    } finally {
      setPending(null);
    }
  }

  const destination = proposal.kind === "goals_replace"
    ? "/goals"
    : proposal.kind === "meal_create"
      ? "/meals"
      : "/meals";

  return (
    <section className="chat-proposal" aria-label={proposalLabel(proposal)}>
      <div className="chat-proposal-heading">
        <strong>{proposalLabel(proposal)}</strong>
        <span className={"proposal-status " + proposal.status}>
          {proposal.status}
        </span>
      </div>
      <p>
        Review the message above. The action runs only once after confirmation
        and expires at {new Date(proposal.expires_at).toLocaleString()}.
      </p>
      {proposal.status === "pending" ? (
        <div className="button-row">
          <button
            className="button primary"
            type="button"
            disabled={disabled || pending !== null}
            onClick={() => void act("confirm")}
          >
            {pending === "confirm" ? "Confirming..." : "Confirm"}
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={disabled || pending !== null}
            onClick={() => void act("cancel")}
          >
            {pending === "cancel" ? "Canceling..." : "Cancel"}
          </button>
        </div>
      ) : (
        <Link className="text-link" to={destination}>
          View affected {proposal.kind === "goals_replace" ? "goals" : "meals"}
        </Link>
      )}
      {failure && <p className="form-error" role="alert">{failure}</p>}
    </section>
  );
}

function MessageBubble({
  message,
  pending,
  onProposalChange,
}: {
  message: ChatMessage;
  pending: boolean;
  onProposalChange(proposal: ChatProposal): void;
}) {
  return (
    <article className={"chat-message " + message.role}>
      <span className="chat-message-role">
        {message.role === "user" ? "You" : "NutriTrack"}
      </span>
      <p>{message.content}</p>
      {message.proposal && (
        <ProposalCard
          proposal={message.proposal}
          disabled={pending}
          onChange={onProposalChange}
        />
      )}
    </article>
  );
}

export function Chat() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [conversationPage, setConversationPage] = useState(1);
  const [conversationPages, setConversationPages] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagePage, setMessagePage] = useState(1);
  const [messagePages, setMessagePages] = useState(0);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState("");
  const [failedText, setFailedText] = useState("");
  const requestController = useRef<AbortController | null>(null);
  const imageRequestController = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [imageMode, setImageMode] = useState<ImageType>("food_plate");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePending, setImagePending] = useState(false);
  const [imageFailure, setImageFailure] = useState("");
  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
  const [imagePreviewFailed, setImagePreviewFailed] = useState(false);
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null);
  const [imageForm, setImageForm] = useState<MealFormInput | null>(null);

  const loadConversationPage = useCallback(async (
    page: number,
    append: boolean,
    signal?: AbortSignal,
  ) => {
    const result = await listConversations(page, 20, signal);
    setConversations((current) => append ? [...current, ...result.items] : result.items);
    setConversationPage(result.pagination.page);
    setConversationPages(result.pagination.total_pages);
    if (!append && !selected && result.items[0]) setSelected(result.items[0].id);
  }, [selected]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailure("");
    Promise.all([
      loadConversationPage(1, false, controller.signal),
      getProfile({ signal: controller.signal }).then(setProfile),
    ])
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.name === "AbortError")) {
          setFailure(errorMessage(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [loadConversationPage, user?.id]);

  useEffect(() => {
    requestSequence.current += 1;
    requestController.current?.abort();
    setMessages([]);
    setMessagePage(1);
    setMessagePages(0);
    setFailure("");
    if (!selected) return;
    const controller = new AbortController();
    listChatMessages(selected, 1, 20, controller.signal)
      .then((result) => {
        setMessages(result.items);
        setMessagePage(result.pagination.page);
        setMessagePages(result.pagination.total_pages);
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.name === "AbortError")) {
          setFailure(errorMessage(error));
        }
      });
    return () => controller.abort();
  }, [selected, user?.id]);

  useEffect(() => () => {
    requestSequence.current += 1;
    requestController.current?.abort();
    imageRequestController.current?.abort();
  }, []);

  useEffect(() => {
    setImagePreviewFailed(false);
    if (!imageFile) {
      setImagePreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setImagePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  async function newConversation() {
    if (pending) return;
    const current = conversations.find((conversation) => conversation.id === selected);
    if (current?.title === "New nutrition conversation" && messages.length === 0) {
      messageInputRef.current?.focus();
      return;
    }

    setFailure("");
    try {
      const conversation = await createConversation();
      setConversations((items) => [conversation, ...items]);
      setSelected(conversation.id);
      requestAnimationFrame(() => messageInputRef.current?.focus());
    } catch (error) {
      setFailure(errorMessage(error));
    }
  }

  async function loadOlderMessages() {
    if (!selected || messagePage >= messagePages) return;
    try {
      const result = await listChatMessages(selected, messagePage + 1, 20);
      setMessages((current) => [...result.items, ...current]);
      setMessagePage(result.pagination.page);
      setMessagePages(result.pagination.total_pages);
    } catch (error) {
      setFailure(errorMessage(error));
    }
  }

  async function send(value = text) {
    const message = value.trim();
    if (!selected || !message || pending) return;
    const sequence = ++requestSequence.current;
    const controller = new AbortController();
    requestController.current?.abort();
    requestController.current = controller;
    setPending(true);
    setFailure("");
    setFailedText("");
    try {
      const turn = await submitChatMessage(selected, message, controller.signal);
      if (sequence !== requestSequence.current || controller.signal.aborted) return;
      setMessages((current) => [
        ...current,
        turn.user_message,
        turn.assistant_message,
      ]);
      setText("");
      await loadConversationPage(1, false);
    } catch (error) {
      if (sequence === requestSequence.current && !controller.signal.aborted) {
        setFailure(errorMessage(error));
        setFailedText(message);
      }
    } finally {
      if (sequence === requestSequence.current) {
        requestController.current = null;
        setPending(false);
      }
    }
  }

  function cancelSend() {
    requestSequence.current += 1;
    requestController.current?.abort();
    requestController.current = null;
    setPending(false);
    setFailure("Request canceled. No unconfirmed proposal was executed.");
  }

  function updateProposal(next: ChatProposal) {
    setMessages((current) => current.map((message) =>
      message.proposal?.id === next.id
        ? { ...message, proposal: next }
        : message,
    ));
  }

  function clearImageAttachment() {
    imageRequestController.current?.abort();
    imageRequestController.current = null;
    setImagePending(false);
    setImageFile(null);
    setExtraction(null);
    setImageForm(null);
    setImageFailure("");
    if (attachmentInputRef.current) attachmentInputRef.current.value = "";
  }

  function selectImageFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    const validation = validateImageFile(file);
    if (validation) {
      setImageFailure(validation);
      event.target.value = "";
      return;
    }
    setImageFailure("");
    setImageFile(file);
    setExtraction(null);
    setImageForm(null);
  }

  async function analyzeImage() {
    if (!selected || imagePending) return;
    const validation = validateImageFile(imageFile);
    if (validation) {
      setImageFailure(validation);
      return;
    }
    if (!imageFile) return;

    const controller = new AbortController();
    imageRequestController.current?.abort();
    imageRequestController.current = controller;
    setImagePending(true);
    setImageFailure("");
    try {
      const result = await extractNutrition(imageFile, imageMode, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setExtraction(result);
      setImageForm(extractionToFormValues(result.draft));
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        setImageFailure(errorMessage(error));
      }
    } finally {
      if (imageRequestController.current === controller) {
        imageRequestController.current = null;
        setImagePending(false);
      }
    }
  }

  function cancelImageAnalysis() {
    imageRequestController.current?.abort();
    imageRequestController.current = null;
    setImagePending(false);
    setImageFailure("Image analysis canceled. Nothing was saved.");
  }

  async function proposeImageMeal(meal: MealPayload) {
    if (!selected || !extraction || imagePending) return;
    setImagePending(true);
    setImageFailure("");
    try {
      const message = await createImageMealProposal(
        selected,
        {
          ...meal,
          entry_source: extraction.draft.entry_source,
          is_estimate: extraction.draft.is_estimate,
        },
        extraction.assumptions,
      );
      setMessages((current) => [...current, message]);
      clearImageAttachment();
    } catch (error) {
      setImageFailure(errorMessage(error));
    } finally {
      setImagePending(false);
    }
  }

  return (
    <main className="content-shell chat-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Gemini-assisted</p>
          <h1>Nutrition chat</h1>
          <p>
            Ask about your diary or nutrition. Reads use your saved data;
            changes always require your confirmation.
          </p>
        </div>
        <button className="button primary" type="button" onClick={() => void newConversation()}>
          New conversation
        </button>
      </header>

      {failure && (
        <div className="form-error" role="alert">
          {failure}
          {failedText && !pending && (
            <button className="text-button" type="button" onClick={() => void send(failedText)}>
              Retry message
            </button>
          )}
        </div>
      )}

      <div className="chat-layout">
        <aside className="chat-sidebar" aria-label="Conversations">
          <h2>Conversations</h2>
          {loading && <p>Loading conversations...</p>}
          {!loading && conversations.length === 0 && <p>Start a new conversation.</p>}
          <div className="conversation-list">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                className={conversation.id === selected ? "active" : ""}
                type="button"
                onClick={() => setSelected(conversation.id)}
              >
                {conversation.title}
              </button>
            ))}
          </div>
          {conversationPage < conversationPages && (
            <button
              className="button secondary"
              type="button"
              onClick={() => void loadConversationPage(conversationPage + 1, true)}
            >
              Show more conversations
            </button>
          )}
        </aside>

        <section className="chat-panel" aria-label="Conversation">
          {!selected ? (
            <div className="empty-state">
              <h2>No conversation selected</h2>
              <p>Create a conversation to begin.</p>
            </div>
          ) : (
            <>
              {messagePage < messagePages && (
                <button className="button secondary" type="button" onClick={() => void loadOlderMessages()}>
                  Show older messages
                </button>
              )}
              <div className="chat-history" role="log" aria-live="polite">
                {messages.length === 0 && (
                  <div className="chat-welcome">
                    <h2>What would you like to do?</h2>
                    <p>Try “Show my breakfasts from last week” or “I had 150 g of cooked rice for lunch today.”</p>
                  </div>
                )}
                {messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    pending={pending}
                    onProposalChange={updateProposal}
                  />
                ))}
                {pending && <p className="chat-thinking" role="status">Gemini is preparing a response...</p>}
              </div>
              {imageForm && extraction && profile && (
                <section
                  className="chat-image-review"
                  aria-labelledby="chat-image-review-heading"
                >
                  <div className="chat-image-review-heading">
                    <div>
                      <p className="eyebrow">Attachment analyzed</p>
                      <h2 id="chat-image-review-heading">Review the meal details</h2>
                    </div>
                    <button
                      className="button secondary"
                      type="button"
                      disabled={imagePending}
                      onClick={clearImageAttachment}
                    >
                      Discard
                    </button>
                  </div>
                  <p>
                    Edit anything Gemini misread. Creating the review still
                    does not save a meal; you will confirm it in chat.
                  </p>
                  <MealForm
                    initialValues={imageForm}
                    today={profile.today}
                    submitLabel="Create review proposal"
                    onSubmit={proposeImageMeal}
                    disableSubmitUntilValid
                    lockProvenance
                  />
                </section>
              )}
              <form
                className="chat-composer"
                aria-label="Chat message"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                {imageFile && (
                  <section className="chat-attachment-preview" aria-label="Selected image attachment">
                    <div className="chat-attachment-thumbnail">
                      {imagePreviewUrl && !imagePreviewFailed ? (
                        <img
                          src={imagePreviewUrl}
                          alt=""
                          onError={() => setImagePreviewFailed(true)}
                        />
                      ) : (
                        <span aria-hidden="true">IMG</span>
                      )}
                    </div>
                    <div className="chat-attachment-copy">
                      <strong>{imageFile.name}</strong>
                      <span>{imageFile.size.toLocaleString()} bytes</span>
                    </div>
                    <label className="chat-attachment-mode">
                      <span>Photo type</span>
                      <select
                        value={imageMode}
                        disabled={pending || imagePending}
                        onChange={(event) => {
                          setImageMode(event.target.value as ImageType);
                          setExtraction(null);
                          setImageForm(null);
                        }}
                      >
                        <option value="food_plate">Plate of food</option>
                        <option value="nutrition_label">Nutrition label</option>
                      </select>
                    </label>
                    <div className="chat-attachment-actions">
                      <button
                        className="button secondary"
                        type="button"
                        disabled={pending || imagePending}
                        onClick={() => void analyzeImage()}
                      >
                        {extraction ? "Analyze again" : "Analyze image"}
                      </button>
                      {imagePending ? (
                        <button
                          className="button secondary"
                          type="button"
                          onClick={cancelImageAnalysis}
                        >
                          Cancel analysis
                        </button>
                      ) : (
                        <button
                          className="chat-remove-attachment"
                          type="button"
                          onClick={clearImageAttachment}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </section>
                )}
                {imageFailure && <p className="form-error" role="alert">{imageFailure}</p>}
                <label className="visually-hidden" htmlFor="chat-message">Message</label>
                <textarea
                  ref={messageInputRef}
                  id="chat-message"
                  value={text}
                  maxLength={2000}
                  rows={3}
                  disabled={pending || imagePending}
                  placeholder="Ask about meals, goals, reports, estimates, or general nutrition..."
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                />
                <div className="chat-composer-toolbar">
                  <input
                    ref={attachmentInputRef}
                    type="file"
                    accept={ACCEPTED_IMAGE_TYPES.join(",")}
                    hidden
                    disabled={pending || imagePending}
                    onChange={selectImageFile}
                  />
                  <button
                    className="chat-attach-button"
                    type="button"
                    disabled={pending || imagePending}
                    aria-label={imageFile ? "Replace image attachment" : "Attach nutrition label or food photo"}
                    title={imageFile ? "Replace image" : "Attach image"}
                    onClick={() => attachmentInputRef.current?.click()}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    <span>{imageFile ? "Replace" : "Attach"}</span>
                  </button>
                  <span className="chat-composer-hint">Enter to send · Shift+Enter for a new line</span>
                  <div className="chat-composer-actions">
                    {pending && (
                      <button className="button secondary" type="button" onClick={cancelSend}>
                        Cancel request
                      </button>
                    )}
                    <button
                      className="chat-send-button"
                      type="submit"
                      disabled={pending || imagePending || !text.trim()}
                      aria-label={pending ? "Sending message" : "Send message"}
                      title="Send message"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="m5 12 14-7-4.5 14-3-5.5L5 12Zm6.5 1.5L19 5" />
                      </svg>
                    </button>
                  </div>
                </div>
              </form>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
