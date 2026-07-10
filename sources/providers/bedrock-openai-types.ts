export interface ActiveBedrockOpenAIOutputItem {
    argumentsJson?: string;
    contentIndex: number;
    type: "message" | "reasoning" | "toolCall";
}
