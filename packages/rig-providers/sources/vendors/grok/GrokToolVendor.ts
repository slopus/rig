export type GrokToolVendor =
    | { readonly provider: "grok"; readonly type: "function_call" }
    | { readonly provider: "grok"; readonly type: "custom_tool_call" }
    | {
          readonly provider: "grok";
          readonly type: "tool_search_call";
          readonly execution: "client";
      };
