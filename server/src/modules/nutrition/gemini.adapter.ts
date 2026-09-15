import type { ProviderState } from "../../config/env.js";
import { requestGeminiJson, type GeminiClientFactory } from "./gemini.transport.js";
import {
  nutritionPrompt,
  parseProviderText,
  type ProviderAdapter,
} from "./provider-common.js";
import { PROVIDER_OUTPUT_JSON_SCHEMA } from "./nutrition.schemas.js";

export function createGeminiAdapter(
  state: ProviderState,
  createClient?: GeminiClientFactory,
): ProviderAdapter {
  return {
    name: "gemini",
    async analyze({ image, imageType, signal, timeoutMs }) {
      const text = await requestGeminiJson({
        state,
        createClient,
        input: [
          { type: "text", text: nutritionPrompt(imageType) },
          {
            type: "image",
            data: image.toString("base64"),
            mime_type: "image/jpeg",
          },
        ],
        responseSchema: PROVIDER_OUTPUT_JSON_SCHEMA,
        signal,
        timeoutMs,
      });
      return parseProviderText(text);
    },
  };
}
