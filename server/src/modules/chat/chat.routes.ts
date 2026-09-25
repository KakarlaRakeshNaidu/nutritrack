import express from "express";
import type { Express, RequestHandler } from "express";

import type { AppConfig } from "../../config/env.js";
import { validateRequest } from "../../middleware/validate-request.js";
import type { Clock, DatabasePool } from "../../types.js";
import { AppError } from "../../utils/errors.js";
import {
  ExtractionRuntime,
  createAiRateLimit,
} from "../nutrition/nutrition.routes.js";
import type { NutritionEstimateService } from "../nutrition/nutrition-estimate.service.js";
import type { ChatPlanner } from "./chat.gemini.js";
import {
  chatPaginationSchema,
  conversationIdParamSchema,
  createConversationSchema,
  emptyChatBodySchema,
  emptyChatQuerySchema,
  imageProposalSchema,
  proposalIdParamSchema,
  submitMessageSchema,
} from "./chat.schemas.js";
import { createChatService } from "./chat.service.js";

const CHAT_TURN_DEADLINE_MS = 30_000;

function requestError(status: number, code: string, message: string): AppError {
  return new AppError({ status, code, message });
}

const requireJson: RequestHandler = (request, _response, next) => {
  if (!request.is("application/json")) {
    next(requestError(415, "UNSUPPORTED_MEDIA_TYPE", "Chat requests require application/json."));
    return;
  }
  next();
};

export function registerChatRoutes(
  app: Express,
  {
    pool,
    config,
    clock,
    planner,
    estimateService,
    runtime,
    aiRateLimit = createAiRateLimit(),
  }: {
    pool: DatabasePool;
    config: Pick<AppConfig, "providers">;
    clock?: Clock;
    planner?: ChatPlanner;
    estimateService?: NutritionEstimateService;
    runtime: ExtractionRuntime;
    aiRateLimit?: RequestHandler;
  },
): void {
  const service = createChatService({
    pool,
    providers: config.providers,
    clock,
    planner,
    estimateService,
  });
  const router = express.Router();

  router.post(
    "/conversations",
    requireJson,
    validateRequest({
      body: createConversationSchema,
      query: emptyChatQuerySchema,
    }),
    async (_request, response) => {
      const conversation = await service.createConversation(
        response.locals.auth.userId,
        response.locals.validated.body.title,
      );
      response
        .location("/api/v1/chat/conversations/" + conversation.id)
        .status(201)
        .json({ data: conversation });
    },
  );

  router.get(
    "/conversations",
    validateRequest({
      body: emptyChatBodySchema,
      query: chatPaginationSchema,
    }),
    async (_request, response) => {
      response.json(await service.listConversations(
        response.locals.auth.userId,
        response.locals.validated.query,
      ));
    },
  );

  router.get(
    "/conversations/:conversationId/messages",
    validateRequest({
      body: emptyChatBodySchema,
      params: conversationIdParamSchema,
      query: chatPaginationSchema,
    }),
    async (_request, response) => {
      response.json(await service.listMessages(
        response.locals.auth.userId,
        response.locals.validated.params.conversationId,
        response.locals.validated.query,
      ));
    },
  );

  router.post(
    "/conversations/:conversationId/messages",
    requireJson,
    aiRateLimit,
    validateRequest({
      body: submitMessageSchema,
      params: conversationIdParamSchema,
      query: emptyChatQuerySchema,
    }),
    async (request, response, next) => {
      const release = runtime.acquire();
      if (!release) {
        response.setHeader("Retry-After", "1");
        next(requestError(429, "AI_BUSY", "Nutrition AI capacity is busy."));
        return;
      }
      const controller = new AbortController();
      const untrack = runtime.track(controller);
      const deadline = setTimeout(
        () => controller.abort("chat-turn-timeout"),
        CHAT_TURN_DEADLINE_MS,
      );
      deadline.unref();
      const onAborted = () => controller.abort("caller-disconnected");
      const onClose = () => {
        if (!response.writableEnded) controller.abort("caller-disconnected");
      };
      request.once("aborted", onAborted);
      response.once("close", onClose);

      try {
        const result = await service.submitMessage({
          userId: response.locals.auth.userId,
          conversationId: response.locals.validated.params.conversationId,
          message: response.locals.validated.body.message,
          signal: controller.signal,
        });
        if (!controller.signal.aborted) response.status(201).json({ data: result });
      } catch (error) {
        if (controller.signal.aborted) {
          if (controller.signal.reason === "chat-turn-timeout") {
            next(requestError(504, "AI_TIMEOUT", "The chat turn exceeded its deadline."));
          } else if (controller.signal.reason === "server-shutdown") {
            next(requestError(503, "AI_PROVIDERS_UNAVAILABLE", "Chat stopped because the server is shutting down."));
          }
          return;
        }
        next(error);
      } finally {
        clearTimeout(deadline);
        request.off("aborted", onAborted);
        response.off("close", onClose);
        untrack();
        release();
      }
    },
  );

  router.post(
    "/conversations/:conversationId/image-proposals",
    requireJson,
    validateRequest({
      body: imageProposalSchema,
      params: conversationIdParamSchema,
      query: emptyChatQuerySchema,
    }),
    async (_request, response) => {
      const message = await service.createImageProposal({
        userId: response.locals.auth.userId,
        conversationId: response.locals.validated.params.conversationId,
        meal: response.locals.validated.body.meal,
        assumptions: response.locals.validated.body.assumptions,
      });
      response.status(201).json({ data: message });
    },
  );

  router.get(
    "/proposals/:proposalId",
    validateRequest({
      body: emptyChatBodySchema,
      params: proposalIdParamSchema,
      query: emptyChatQuerySchema,
    }),
    async (_request, response) => {
      response.json({ data: await service.getProposal(
        response.locals.auth.userId,
        response.locals.validated.params.proposalId,
      ) });
    },
  );

  for (const action of ["confirm", "cancel"] as const) {
    router.post(
      "/proposals/:proposalId/" + action,
      validateRequest({
        body: emptyChatBodySchema,
        params: proposalIdParamSchema,
        query: emptyChatQuerySchema,
      }),
      async (_request, response) => {
        const proposal = action === "confirm"
          ? await service.confirmProposal(
              response.locals.auth.userId,
              response.locals.validated.params.proposalId,
            )
          : await service.cancelProposal(
              response.locals.auth.userId,
              response.locals.validated.params.proposalId,
            );
        response.json({ data: proposal });
      },
    );
  }

  app.use("/api/v1/chat", router);
}
