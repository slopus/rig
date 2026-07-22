export interface ActiveOpenAIResponsesOutputItem {
    argumentsJson?: string;
    customInput?: string;
    contentIndex: number;
    type: "message" | "reasoning" | "toolCall";
}
