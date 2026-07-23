export type CodexToolVendor =
    | { readonly provider: "codex"; readonly type: "function_call" }
    | { readonly provider: "codex"; readonly type: "custom_tool_call" }
    | {
          readonly provider: "codex";
          readonly type: "tool_search_call";
          readonly execution: "client";
      };

export type CodexToolDefinitionVendor =
    | {
          readonly provider: "codex";
          readonly type: "function";
          readonly deferLoading?: boolean;
      }
    | {
          readonly provider: "codex";
          readonly type: "tool_search";
          readonly execution: "client";
      };
