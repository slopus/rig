export type CodexProfileStem = "codex-gpt-5-6-sol" | "codex-gpt-5-6-terra" | "codex-gpt-5-6-luna";

export interface CodexProfileArtifactDescriptor {
    stem: CodexProfileStem;
    slug: "gpt-5.6-sol" | "gpt-5.6-terra" | "gpt-5.6-luna";
    displayName: "GPT-5.6 Sol" | "GPT-5.6 Terra" | "GPT-5.6 Luna";
    identity: string;
    multiAgentVersion: "v1" | "v2";
    clientTools: readonly string[];
}

export interface CodexProfileCapture {
    formatVersion: 1;
    source: {
        repository: "https://github.com/openai/codex";
        branch: "main";
        commit: string;
        commitDate: string;
        commitSubject: string;
        path: "codex-rs/models-manager/models.json";
        captureMethod: "Read base_instructions directly from the checked-out Codex source";
    };
    model: {
        slug: string;
        toolMode: string;
        multiAgentVersion: string;
        baseInstructionsSha256: string;
        clientTools: readonly string[];
    };
    tools: {
        client: "@openai/codex";
        version: string;
        sourceDescription: string;
        captureMethod: string;
        sha256: string;
    };
}

const CODE_MODE_V2_TOOLS = ["exec", "wait", "request_user_input", "collaboration"] as const;
const CODE_MODE_V1_TOOLS = ["exec", "wait", "request_user_input"] as const;

export const CODEX_PROFILE_ARTIFACTS: readonly CodexProfileArtifactDescriptor[] = [
    {
        stem: "codex-gpt-5-6-sol",
        slug: "gpt-5.6-sol",
        displayName: "GPT-5.6 Sol",
        identity:
            "You are Rig, a coding agent powered by GPT-5.6 Sol. You operate through Rig's tools, permissions, and runtime.",
        clientTools: CODE_MODE_V2_TOOLS,
        multiAgentVersion: "v2",
    },
    {
        stem: "codex-gpt-5-6-terra",
        slug: "gpt-5.6-terra",
        displayName: "GPT-5.6 Terra",
        identity:
            "You are Rig, a coding agent powered by GPT-5.6 Terra. You operate through Rig's tools, permissions, and runtime.",
        clientTools: CODE_MODE_V2_TOOLS,
        multiAgentVersion: "v2",
    },
    {
        stem: "codex-gpt-5-6-luna",
        slug: "gpt-5.6-luna",
        displayName: "GPT-5.6 Luna",
        identity:
            "You are Rig, a coding agent powered by GPT-5.6 Luna. You operate through Rig's tools, permissions, and runtime.",
        clientTools: CODE_MODE_V1_TOOLS,
        multiAgentVersion: "v1",
    },
];
