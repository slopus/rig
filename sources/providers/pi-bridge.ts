import type {
  AssistantMessage as PiAssistantMessage,
  AssistantMessageEvent as PiAssistantMessageEvent,
  AssistantMessageEventStream,
  Context as PiContext,
  ImageContent as PiImageContent,
  Message as PiMessage,
  TextContent as PiTextContent,
  ThinkingContent as PiThinkingContent,
  Tool as PiTool,
  ToolCall as PiToolCall,
  ToolResultMessage as PiToolResultMessage,
  UserMessage as PiUserMessage,
} from "@mariozechner/pi-ai";

import type {
  AssistantContent,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  ImageContent,
  InferenceStream,
  Message,
  TextContent,
  ThinkingContent,
  Tool,
  ToolCall,
  ToolResultContent,
  ToolResultMessage,
  UserContent,
  UserMessage,
} from "./types.js";

export function toPiContext(context: Context): PiContext {
  return {
    ...(context.systemPrompt !== undefined
      ? { systemPrompt: context.systemPrompt }
      : {}),
    messages: context.messages.map(toPiMessage),
    ...(context.tools !== undefined
      ? { tools: context.tools.map(toPiTool) }
      : {}),
  };
}

export function wrapPiStream(
  piStream: AssistantMessageEventStream,
): InferenceStream {
  return {
    async *[Symbol.asyncIterator]() {
      for await (const event of piStream) {
        yield fromPiEvent(event);
      }
    },
    result: async () => fromPiAssistantMessage(await piStream.result()),
  };
}

function toPiTool(tool: Tool): PiTool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

function toPiMessage(message: Message): PiMessage {
  switch (message.role) {
    case "user":
      return toPiUserMessage(message);
    case "assistant":
      return toPiAssistantMessage(message);
    case "toolResult":
      return toPiToolResultMessage(message);
  }
}

function toPiUserMessage(message: UserMessage): PiUserMessage {
  return {
    role: "user",
    content:
      typeof message.content === "string"
        ? message.content
        : message.content.map(toPiUserContent),
    timestamp: message.timestamp,
  };
}

function toPiAssistantMessage(message: AssistantMessage): PiAssistantMessage {
  return {
    role: "assistant",
    content: message.content.map(toPiAssistantContent),
    api: message.api,
    provider: message.provider,
    model: message.model,
    ...(message.responseModel !== undefined
      ? { responseModel: message.responseModel }
      : {}),
    ...(message.responseId !== undefined
      ? { responseId: message.responseId }
      : {}),
    usage: message.usage,
    stopReason: message.stopReason,
    ...(message.errorMessage !== undefined
      ? { errorMessage: message.errorMessage }
      : {}),
    timestamp: message.timestamp,
  };
}

function toPiToolResultMessage(message: ToolResultMessage): PiToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    content: message.content.map(toPiToolResultContent),
    isError: message.isError,
    timestamp: message.timestamp,
  };
}

function toPiUserContent(content: UserContent): PiTextContent | PiImageContent {
  if (content.type === "text") {
    return {
      type: "text",
      text: content.text,
      ...(content.textSignature !== undefined
        ? { textSignature: content.textSignature }
        : {}),
    };
  }

  return {
    type: "image",
    data: content.data,
    mimeType: content.mimeType,
  };
}

function toPiToolResultContent(
  content: ToolResultContent,
): PiTextContent | PiImageContent {
  return toPiUserContent(content);
}

function toPiAssistantContent(
  content: AssistantContent,
): PiTextContent | PiThinkingContent | PiToolCall {
  if (content.type === "text") {
    return {
      type: "text",
      text: content.text,
      ...(content.textSignature !== undefined
        ? { textSignature: content.textSignature }
        : {}),
    };
  }

  if (content.type === "thinking") {
    return {
      type: "thinking",
      thinking: content.thinking,
      ...(content.encrypted !== undefined
        ? { thinkingSignature: content.encrypted }
        : {}),
      ...(content.redacted !== undefined ? { redacted: content.redacted } : {}),
    };
  }

  return {
    type: "toolCall",
    id: content.id,
    name: content.name,
    arguments: content.arguments,
  };
}

function fromPiEvent(event: PiAssistantMessageEvent): AssistantMessageEvent {
  switch (event.type) {
    case "start":
      return {
        type: "start",
        partial: fromPiAssistantMessage(event.partial),
      };
    case "text_start":
      return {
        type: "text_start",
        contentIndex: event.contentIndex,
        partial: fromPiAssistantMessage(event.partial),
      };
    case "text_delta":
      return {
        type: "text_delta",
        contentIndex: event.contentIndex,
        delta: event.delta,
        partial: fromPiAssistantMessage(event.partial),
      };
    case "text_end":
      return {
        type: "text_end",
        contentIndex: event.contentIndex,
        content: event.content,
        partial: fromPiAssistantMessage(event.partial),
      };
    case "thinking_start":
      return {
        type: "thinking_start",
        contentIndex: event.contentIndex,
        partial: fromPiAssistantMessage(event.partial),
      };
    case "thinking_delta":
      return {
        type: "thinking_delta",
        contentIndex: event.contentIndex,
        delta: event.delta,
        partial: fromPiAssistantMessage(event.partial),
      };
    case "thinking_end":
      return {
        type: "thinking_end",
        contentIndex: event.contentIndex,
        content: event.content,
        partial: fromPiAssistantMessage(event.partial),
      };
    case "toolcall_start":
      return {
        type: "toolcall_start",
        contentIndex: event.contentIndex,
        partial: fromPiAssistantMessage(event.partial),
      };
    case "toolcall_delta":
      return {
        type: "toolcall_delta",
        contentIndex: event.contentIndex,
        delta: event.delta,
        partial: fromPiAssistantMessage(event.partial),
      };
    case "toolcall_end":
      return {
        type: "toolcall_end",
        contentIndex: event.contentIndex,
        toolCall: fromPiToolCall(event.toolCall),
        partial: fromPiAssistantMessage(event.partial),
      };
    case "done":
      return {
        type: "done",
        reason: event.reason,
        message: fromPiAssistantMessage(event.message),
      };
    case "error":
      return {
        type: "error",
        reason: event.reason,
        error: fromPiAssistantMessage(event.error),
      };
  }
}

function fromPiAssistantMessage(message: PiAssistantMessage): AssistantMessage {
  return {
    role: "assistant",
    content: message.content.map(fromPiAssistantContent),
    api: message.api,
    provider: message.provider,
    model: message.model,
    ...(message.responseModel !== undefined
      ? { responseModel: message.responseModel }
      : {}),
    ...(message.responseId !== undefined
      ? { responseId: message.responseId }
      : {}),
    usage: message.usage,
    stopReason: message.stopReason,
    ...(message.errorMessage !== undefined
      ? { errorMessage: message.errorMessage }
      : {}),
    timestamp: message.timestamp,
  };
}

function fromPiAssistantContent(
  content: PiAssistantMessage["content"][number],
): AssistantContent {
  if (content.type === "text") {
    return fromPiTextContent(content);
  }

  if (content.type === "thinking") {
    return fromPiThinkingContent(content);
  }

  return fromPiToolCall(content);
}

function fromPiTextContent(content: PiTextContent): TextContent {
  return {
    type: "text",
    text: content.text,
    ...(content.textSignature !== undefined
      ? { textSignature: content.textSignature }
      : {}),
  };
}

function fromPiThinkingContent(content: PiThinkingContent): ThinkingContent {
  return {
    type: "thinking",
    thinking: content.thinking,
    ...(content.thinkingSignature !== undefined
      ? { encrypted: content.thinkingSignature }
      : {}),
    ...(content.redacted !== undefined ? { redacted: content.redacted } : {}),
  };
}

function fromPiToolCall(toolCall: PiToolCall): ToolCall {
  return {
    type: "toolCall",
    id: toolCall.id,
    name: toolCall.name,
    arguments: toolCall.arguments,
  };
}
