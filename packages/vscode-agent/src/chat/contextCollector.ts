import type { RuntimeContextSnapshot } from "../context.js";
import {
  collectTaskContext,
  type NormalizedTaskContextRequest
} from "../nl/taskContext.js";
import type { TaskIntent } from "../nl/taskTypes.js";
import type { UIContextRequest } from "./chatProtocol.js";

export type CollectedChatContext = {
  request: NormalizedTaskContextRequest;
  runtime: RuntimeContextSnapshot | undefined;
  renderedContext: string;
};

const CHAT_CONTEXT_INTENT: TaskIntent = {
  kind: "explain",
  confidence: 1,
  summary: "Collect context for assistant chat requests."
};

export async function collectChatContext(
  request: UIContextRequest
): Promise<CollectedChatContext> {
  const collected = await collectTaskContext(CHAT_CONTEXT_INTENT, request);
  return {
    request: collected.request,
    runtime: collected.runtime,
    renderedContext: collected.renderedContext
  };
}
