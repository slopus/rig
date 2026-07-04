export type AppTranscriptRole =
  | "system"
  | "user"
  | "assistant"
  | "tool"
  | "event"
  | "error";

export interface AppTranscriptEntry {
  id: string;
  role: AppTranscriptRole;
  text: string;
  title?: string;
}
