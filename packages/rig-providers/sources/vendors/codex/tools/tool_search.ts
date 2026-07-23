import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";
import type { CodexToolDefinitionVendor } from "@/vendors/codex/CodexToolVendor.js";

export const tool_search = {
    name: "tool_search",
    type: "local",
    vendor: {
        provider: "codex",
        type: "tool_search",
        execution: "client",
    },
    description:
        "# Tool discovery\n\nSearches over deferred tool metadata with BM25 and exposes matching tools for the next model call.\n\nYou have access to tools from the following sources:\n- AllTrails: Enables discovery and exploration of outdoor trails (hiking, running, biking, backpacking, etc.) by searching near a point, within a geographic bounding box, near the user, or by trail name, with rich filters for conditions, difficulty, and suitability. Provides detailed trail information and a 7-day trailhead weather forecast for specific trails.\n- Apple Music: Searches the Apple Music catalog for specific artists, albums, songs, and playlists, and returns canonical catalog objects suitable for navigation or display. Also enriches model-generated song lists by batch-matching them to Apple Music tracks, adding official metadata and playable links for draft playlists or curated song collections.\n- Bee Production\n- Codex Document Control: Use Codex Document Control to find connected document sessions, inspect the tools supported by a selected session, and execute one supported tool against that session. Call `list_document_sessions` first to choose the intended connected session, call `get_document_tool_schemas` before constructing tool arguments, then call `execute_document_command` with a caller-stable `idempotency_key`. Use this only for connected Codex document control; do not use it for general spreadsheet, presentation, or document tasks without a connected document session.\n- GitHub: Access repositories, issues, and pull requests. Required for some features such as Codex\n- Happy List\n- Hotline: Look up local hotline information for the user based on country inferred from the conversation. You must use this tool before providing helpline information; do not guess.\n- Multi-agent tools: Spawn and manage sub-agents.\n- Plugin Management: Plugin Management: uninstall: uninstall_app; install/connect: api_tool.search_plugins then api_tool.suggest_installs. Codex uninstall: plugin_management.uninstall_plugin; install: request_plugin_install. Use Plugin Management, not named plugin tools, for permissions/removal/deps. Clarify ambiguity with exact IDs. Route named-plugin access questions and approval-label requests (Always ask, Any changes, Important actions, Never ask, Use my default), even without permission wording. Call the matching tool for clear targets/modes or global/default changes. Ask without calling for missing/broad targets (Google), vague/conflicting modes, risky removal, or delegated choice. Disable is unsupported; explain without calling. Exclude how-to/undo, OAuth/admin scopes, npm/Chrome/code plugins, and ordinary use. Complete all actions; report only confirmed results.\n- Sites: Use Sites to build, save, deploy, and inspect websites such as landing pages, portfolios, dashboards, portals, trackers, hubs, games, and internal tools. Always use Sites when .openai/hosting.json exists. Use Sites skills for local implementation, validation, source preparation, and artifact packaging. Use this connector for site creation, runtime environment variables, versions, production deployments, and access controls. Read .openai/hosting.json before creating a site and reuse its project_id when present. Treat Sites IDs and cursors as opaque: copy them exactly from .openai/hosting.json or Sites responses as applicable, and never invent, reformat, derive, or substitute them. Never call create_site more than once for the same local site. Push the exact source state before saving a version. commit_sha must identify that pushed state, and any archive must be built from it. Deploy only saved versions; every Sites deployment URL is production. Inspect deployment status when the initial result is non-terminal or the user asks for progress. Unless the user asks for local-only work or a saved version without deployment, finish deployable site work with a production deployment.\nSome of the tools may not have been provided to you upfront, and you should use this tool (`tool_search`) to search for the required tools. For MCP tool discovery, always use `tool_search` instead of `list_mcp_resources` or `list_mcp_resource_templates`.",
    parameters: Type.Object(
        {
            limit: Type.Optional(
                Type.Number({ description: "Maximum number of tools to return. Defaults to 8." }),
            ),
            query: Type.String({ description: "Search query for deferred tools." }),
        },
        { additionalProperties: false },
    ),
} as const satisfies SessionTool & { readonly vendor: CodexToolDefinitionVendor };
