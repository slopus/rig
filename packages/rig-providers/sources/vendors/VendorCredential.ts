import type { BedrockBearerTokenCredential } from "@/vendors/bedrock/BedrockBearerTokenCredential.js";
import type { ClaudeApiKeyCredential } from "@/vendors/claude/ClaudeApiKeyCredential.js";
import type { ClaudeAuthTokenCredential } from "@/vendors/claude/ClaudeAuthTokenCredential.js";
import type { ClaudeOAuthCredential } from "@/vendors/claude/ClaudeOAuthCredential.js";
import type { CodexApiKeyCredential } from "@/vendors/codex/CodexApiKeyCredential.js";
import type { CodexSessionCredential } from "@/vendors/codex/CodexSessionCredential.js";
import type { GeminiApiKeyCredential } from "@/vendors/gemini/GeminiApiKeyCredential.js";
import type { GrokApiKeyCredential } from "@/vendors/grok/GrokApiKeyCredential.js";
import type { GrokSessionCredential } from "@/vendors/grok/GrokSessionCredential.js";

export type BedrockCredential = BedrockBearerTokenCredential;

export type ClaudeCredential =
    | ClaudeApiKeyCredential
    | ClaudeAuthTokenCredential
    | ClaudeOAuthCredential;

export type CodexCredential = CodexApiKeyCredential | CodexSessionCredential;

export type CodexProviderCredential = BedrockCredential | CodexCredential;

export type GeminiCredential = GeminiApiKeyCredential;

export type GrokCredential = GrokApiKeyCredential | GrokSessionCredential;

export type VendorCredential =
    | BedrockCredential
    | ClaudeCredential
    | CodexCredential
    | GeminiCredential
    | GrokCredential;
