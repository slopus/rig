import type { SessionSkill } from "@/core/SessionSkill.js";

export const codexSkills = [
    {
        "name": "imagegen",
        "description": "Generate or edit raster images when the task benefits from AI-created bitmap visuals such as photos, illustrations, textures, sprites, mockups, or transparent-background cutouts. Use when Codex should create a brand-new image, transform an existing image, or derive visual variants from references, and the output should be a bitmap asset rather than repo-native code or vector. Do not use when the task is better handled by editing existing SVG/vector/code-native assets, extending an established icon or logo system, or building the visual directly in HTML/CSS/canvas.",
        "source": "file",
        "location": "/private<CAPTURE_DIRECTORY>/codex-home/skills/.system/imagegen/SKILL.md"
    },
    {
        "name": "openai-docs",
        "description": "Use when the user asks how to build with OpenAI products or APIs, asks about Codex itself or choosing Codex surfaces, needs up-to-date official documentation with citations, help choosing the latest model for a use case, latest/current/default-model prompting guidance, or model upgrade and prompt-upgrade guidance; use OpenAI docs MCP tools for non-Codex docs questions, use the Codex manual helper first for broad Codex self-knowledge, and restrict fallback browsing to official OpenAI domains.",
        "source": "file",
        "location": "/private<CAPTURE_DIRECTORY>/codex-home/skills/.system/openai-docs/SKILL.md"
    },
    {
        "name": "plugin-creator",
        "description": "Create and scaffold plugin directories for Codex with a required `.codex-plugin/plugin.json`, optional plugin folders/files, valid manifest defaults, and personal-marketplace entries by default. Use when Codex needs to create a new personal plugin, add optional plugin structure, generate or update marketplace entries for plugin ordering and availability metadata, or update an existing local plugin during development with the CLI-driven cachebuster and reinstall flow.",
        "source": "file",
        "location": "/private<CAPTURE_DIRECTORY>/codex-home/skills/.system/plugin-creator/SKILL.md"
    },
    {
        "name": "skill-creator",
        "description": "Guide for creating effective skills. This skill should be used when users want to create a new skill (or update an existing skill) that extends Codex's capabilities with specialized knowledge, workflows, or tool integrations.",
        "source": "file",
        "location": "/private<CAPTURE_DIRECTORY>/codex-home/skills/.system/skill-creator/SKILL.md"
    },
    {
        "name": "skill-installer",
        "description": "Install Codex skills into $CODEX_HOME/skills from a curated list or a GitHub repo path. Use when a user asks to list installable skills, install a curated skill, or install a skill from another repo (including private repos).",
        "source": "file",
        "location": "/private<CAPTURE_DIRECTORY>/codex-home/skills/.system/skill-installer/SKILL.md"
    },
    {
        "name": "agent-browser",
        "description": "Browser automation CLI for AI agents. Use when the user needs to interact with websites, including navigating pages, filling forms, clicking buttons, taking screenshots, extracting data, testing web apps, or automating any browser task. Triggers include requests to \"open a website\", \"fill out a form\", \"click a button\", \"take a screenshot\", \"scrape data from a page\", \"test this web app\", \"login to a site\", \"automate browser actions\", or any task requiring programmatic web interaction.",
        "source": "file",
        "location": "<HOME>/.agents/skills/agent-browser/SKILL.md"
    },
    {
        "name": "algorithmic-art",
        "description": "Creating algorithmic art using p5.js with seeded randomness and interactive parameter exploration. Use this when users request creating art using code, generative art, algorithmic art, flow fields, or particle systems. Create original algorithmic art rather than copying existing artists' work to avoid copyright violations.",
        "source": "file",
        "location": "<HOME>/.agents/skills/algorithmic-art/SKILL.md"
    },
    {
        "name": "building-native-ui",
        "description": "Complete guide for building beautiful apps with Expo Router. Covers fundamentals, styling, components, navigation, animations, patterns, and native tabs.",
        "source": "file",
        "location": "<HOME>/.agents/skills/building-native-ui/SKILL.md"
    },
    {
        "name": "code-review",
        "description": "AI-powered code review using CodeRabbit. Default code-review skill. Trigger for any explicit review request AND autonomously when the agent thinks a review is needed (code/PR/quality/security).",
        "source": "file",
        "location": "<HOME>/.agents/skills/code-review/SKILL.md"
    },
    {
        "name": "expo-api-routes",
        "description": "Guidelines for creating API routes in Expo Router with EAS Hosting",
        "source": "file",
        "location": "<HOME>/.agents/skills/expo-api-routes/SKILL.md"
    },
    {
        "name": "expo-cicd-workflows",
        "description": "Helps understand and write EAS workflow YAML files for Expo projects. Use this skill when the user asks about CI/CD or workflows in an Expo or EAS context, mentions .eas/workflows/, or wants help with EAS build pipelines or deployment automation.",
        "source": "file",
        "location": "<HOME>/.agents/skills/expo-cicd-workflows/SKILL.md"
    },
    {
        "name": "expo-deployment",
        "description": "Deploying Expo apps to iOS App Store, Android Play Store, web hosting, and API routes",
        "source": "file",
        "location": "<HOME>/.agents/skills/expo-deployment/SKILL.md"
    },
    {
        "name": "expo-dev-client",
        "description": "Build and distribute Expo development clients locally or via TestFlight",
        "source": "file",
        "location": "<HOME>/.agents/skills/expo-dev-client/SKILL.md"
    },
    {
        "name": "expo-tailwind-setup",
        "description": "Set up Tailwind CSS v4 in Expo with react-native-css and NativeWind v5 for universal styling",
        "source": "file",
        "location": "<HOME>/.agents/skills/expo-tailwind-setup/SKILL.md"
    },
    {
        "name": "find-skills",
        "description": "Helps users discover and install agent skills when they ask questions like \"how do I do X\", \"find a skill for X\", \"is there a skill that can...\", or express interest in extending capabilities. This skill should be used when the user is looking for functionality that might exist as an installable skill.",
        "source": "file",
        "location": "<HOME>/.agents/skills/find-skills/SKILL.md"
    },
    {
        "name": "frontend-design",
        "description": "Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, artifacts, posters, or applications (examples include websites, landing pages, dashboards, React components, HTML/CSS layouts, or when styling/beautifying any web UI). Generates creative, polished code and UI design that avoids generic AI aesthetics.",
        "source": "file",
        "location": "<HOME>/.agents/skills/frontend-design/SKILL.md"
    },
    {
        "name": "my-logs",
        "description": "Explain how to do logging",
        "source": "file",
        "location": "<HOME>/.agents/skills/my-logs/SKILL.md"
    },
    {
        "name": "my-plan",
        "description": "Use for planning work",
        "source": "file",
        "location": "<HOME>/.agents/skills/my-plan/SKILL.md"
    },
    {
        "name": "my-web",
        "description": "React web development conventions and patterns",
        "source": "file",
        "location": "<HOME>/.agents/skills/my-web/SKILL.md"
    },
    {
        "name": "my-web-plan",
        "description": "Planning for React web UI implementation with component design focus",
        "source": "file",
        "location": "<HOME>/.agents/skills/my-web-plan/SKILL.md"
    },
    {
        "name": "native-data-fetching",
        "description": "Use when implementing or debugging ANY network request, API call, or data fetching. Covers fetch API, React Query, SWR, error handling, caching, offline support, and Expo Router data loaders (`useLoaderData`).",
        "source": "file",
        "location": "<HOME>/.agents/skills/native-data-fetching/SKILL.md"
    },
    {
        "name": "office-hours",
        "description": "MANUAL TRIGGER ONLY: invoke only when user types /office-hours. YC Office Hours — two modes. Startup mode: six forcing questions that expose demand reality, status quo, desperate specificity, narrowest wedge, observation, and future-fit. Builder mode: design thinking brainstorming for side projects, hackathons, learning, and open source. Saves a design doc. Use when asked to \"brainstorm this\", \"I have an idea\", \"help me think through this\", \"office hours\", or \"is this worth building\". Proactively suggest when the user describes a new product idea or is exploring whether something is worth building — before any code is written.",
        "source": "file",
        "location": "<HOME>/.agents/skills/office-hours/SKILL.md"
    },
    {
        "name": "pdf",
        "description": "Use this skill whenever the user wants to do anything with PDF files. This includes reading or extracting text/tables from PDFs, combining or merging multiple PDFs into one, splitting PDFs apart, rotating pages, adding watermarks, creating new PDFs, filling PDF forms, encrypting/decrypting PDFs, extracting images, and OCR on scanned PDFs to make them searchable. If the user mentions a .pdf file or asks to produce one, use this skill.",
        "source": "file",
        "location": "<HOME>/.agents/skills/pdf/SKILL.md"
    },
    {
        "name": "pptx",
        "description": "Use this skill any time a .pptx file is involved in any way — as input, output, or both. This includes: creating slide decks, pitch decks, or presentations; reading, parsing, or extracting text from any .pptx file (even if the extracted content will be used elsewhere, like in an email or summary); editing, modifying, or updating existing presentations; combining or splitting slide files; working with templates, layouts, speaker notes, or comments. Trigger whenever the user mentions \"deck,\" \"slides,\" \"presentation,\" or references a .pptx filename, regardless of what they plan to do with the content afterward. If a .pptx file needs to be opened, created, or touched, use this skill.",
        "source": "file",
        "location": "<HOME>/.agents/skills/pptx/SKILL.md"
    },
    {
        "name": "remotion-best-practices",
        "description": "Best practices for Remotion - Video creation in React",
        "source": "file",
        "location": "<HOME>/.agents/skills/remotion-best-practices/SKILL.md"
    },
    {
        "name": "slack-gif-creator",
        "description": "Knowledge and utilities for creating animated GIFs optimized for Slack. Provides constraints, validation tools, and animation concepts. Use when users request animated GIFs for Slack like \"make me a GIF of X doing Y for Slack.\"",
        "source": "file",
        "location": "<HOME>/.agents/skills/slack-gif-creator/SKILL.md"
    },
    {
        "name": "sprint",
        "description": "Plan and execute 2-week engineering sprints with structured debate, task-by-task execution, and incremental markdown reporting. Use when asked to \"plan a sprint\", \"create a sprint\", \"execute a sprint\", \"resume a sprint\", or \"plan roadmap\". Supports pause/resume, tracks progress in markdown files as source of truth. Scans the project, proposes a plan, critiques it, synthesizes a final plan, then executes each task sequentially with review after each one.",
        "source": "file",
        "location": "<HOME>/.agents/skills/sprint/SKILL.md"
    },
    {
        "name": "theme-factory",
        "description": "Toolkit for styling artifacts with a theme. These artifacts can be slides, docs, reportings, HTML landing pages, etc. There are 10 pre-set themes with colors/fonts that you can apply to any artifact that has been creating, or can generate a new theme on-the-fly.",
        "source": "file",
        "location": "<HOME>/.agents/skills/theme-factory/SKILL.md"
    },
    {
        "name": "upgrading-expo",
        "description": "Guidelines for upgrading Expo SDK versions and fixing dependency issues",
        "source": "file",
        "location": "<HOME>/.agents/skills/upgrading-expo/SKILL.md"
    },
    {
        "name": "use-dom",
        "description": "Use Expo DOM components to run web code in a webview on native and as-is on web. Migrate web code to native incrementally.",
        "source": "file",
        "location": "<HOME>/.agents/skills/use-dom/SKILL.md"
    },
    {
        "name": "web-artifacts-builder",
        "description": "Suite of tools for creating elaborate, multi-component claude.ai HTML artifacts using modern frontend web technologies (React, Tailwind CSS, shadcn/ui). Use for complex artifacts requiring state management, routing, or shadcn/ui components - not for simple single-file HTML/JSX artifacts.",
        "source": "file",
        "location": "<HOME>/.agents/skills/web-artifacts-builder/SKILL.md"
    },
    {
        "name": "webapp-testing",
        "description": "Toolkit for interacting with and testing local web applications using Playwright. Supports verifying frontend functionality, debugging UI behavior, capturing browser screenshots, and viewing browser logs.",
        "source": "file",
        "location": "<HOME>/.agents/skills/webapp-testing/SKILL.md"
    },
    {
        "name": "xlsx",
        "description": "Use this skill any time a spreadsheet file is the primary input or output. This means any task where the user wants to: open, read, edit, or fix an existing .xlsx, .xlsm, .csv, or .tsv file (e.g., adding columns, computing formulas, formatting, charting, cleaning messy data); create a new spreadsheet from scratch or from other data sources; or convert between tabular file formats. Trigger especially when the user references a spreadsheet file by name or path — even casually (like \"the xlsx in my downloads\") — and wants something done to it or produced from it. Also trigger for cleaning or restructuring messy tabular data files (malformed rows, misplaced headers, junk data) into proper spreadsheets. The deliverable must be a spreadsheet file. Do NOT trigger when the primary deliverable is a Word document, HTML report, standalone Python script, database pipeline, or Google Sheets API integration, even if tabular data is involved.",
        "source": "file",
        "location": "<HOME>/.agents/skills/xlsx/SKILL.md"
    }
] as const satisfies readonly SessionSkill[];

export const codexSkillsWithGithub = [
    {
        "name": "imagegen",
        "description": "Generate or edit raster images when the task benefits from AI-created bitmap visuals such as photos, illustrations, textures, sprites, mockups, or transparent-background cutouts. Use when Codex should create a brand-new image, transform an existing image, or derive visual variants from references, and the output should be a bitmap asset rather than repo-native code or vector. Do not use when the task is better handled by editing existing SVG/vector/code-native assets, extending an established icon or logo system, or building the visual directly in HTML/CSS/canvas.",
        "source": "file",
        "location": "/private<CAPTURE_DIRECTORY>/codex-home/skills/.system/imagegen/SKILL.md"
    },
    {
        "name": "openai-docs",
        "description": "Use when the user asks how to build with OpenAI products or APIs, asks about Codex itself or choosing Codex surfaces, needs up-to-date official documentation with citations, help choosing the latest model for a use case, latest/current/default-model prompting guidance, or model upgrade and prompt-upgrade guidance; use OpenAI docs MCP tools for non-Codex docs questions, use the Codex manual helper first for broad Codex self-knowledge, and restrict fallback browsing to official OpenAI domains.",
        "source": "file",
        "location": "/private<CAPTURE_DIRECTORY>/codex-home/skills/.system/openai-docs/SKILL.md"
    },
    {
        "name": "plugin-creator",
        "description": "Create and scaffold plugin directories for Codex with a required `.codex-plugin/plugin.json`, optional plugin folders/files, valid manifest defaults, and personal-marketplace entries by default. Use when Codex needs to create a new personal plugin, add optional plugin structure, generate or update marketplace entries for plugin ordering and availability metadata, or update an existing local plugin during development with the CLI-driven cachebuster and reinstall flow.",
        "source": "file",
        "location": "/private<CAPTURE_DIRECTORY>/codex-home/skills/.system/plugin-creator/SKILL.md"
    },
    {
        "name": "skill-creator",
        "description": "Guide for creating effective skills. This skill should be used when users want to create a new skill (or update an existing skill) that extends Codex's capabilities with specialized knowledge, workflows, or tool integrations.",
        "source": "file",
        "location": "/private<CAPTURE_DIRECTORY>/codex-home/skills/.system/skill-creator/SKILL.md"
    },
    {
        "name": "skill-installer",
        "description": "Install Codex skills into $CODEX_HOME/skills from a curated list or a GitHub repo path. Use when a user asks to list installable skills, install a curated skill, or install a skill from another repo (including private repos).",
        "source": "file",
        "location": "/private<CAPTURE_DIRECTORY>/codex-home/skills/.system/skill-installer/SKILL.md"
    },
    {
        "name": "agent-browser",
        "description": "Browser automation CLI for AI agents. Use when the user needs to interact with websites, including navigating pages, filling forms, clicking buttons, taking screenshots, extracting data, testing web apps, or automating any browser task. Triggers include requests to \"open a website\", \"fill out a form\", \"click a button\", \"take a screenshot\", \"scrape data from a page\", \"test this web app\", \"login to a site\", \"automate browser actions\", or any task requiring programmatic web interaction.",
        "source": "file",
        "location": "<HOME>/.agents/skills/agent-browser/SKILL.md"
    },
    {
        "name": "algorithmic-art",
        "description": "Creating algorithmic art using p5.js with seeded randomness and interactive parameter exploration. Use this when users request creating art using code, generative art, algorithmic art, flow fields, or particle systems. Create original algorithmic art rather than copying existing artists' work to avoid copyright violations.",
        "source": "file",
        "location": "<HOME>/.agents/skills/algorithmic-art/SKILL.md"
    },
    {
        "name": "building-native-ui",
        "description": "Complete guide for building beautiful apps with Expo Router. Covers fundamentals, styling, components, navigation, animations, patterns, and native tabs.",
        "source": "file",
        "location": "<HOME>/.agents/skills/building-native-ui/SKILL.md"
    },
    {
        "name": "code-review",
        "description": "AI-powered code review using CodeRabbit. Default code-review skill. Trigger for any explicit review request AND autonomously when the agent thinks a review is needed (code/PR/quality/security).",
        "source": "file",
        "location": "<HOME>/.agents/skills/code-review/SKILL.md"
    },
    {
        "name": "expo-api-routes",
        "description": "Guidelines for creating API routes in Expo Router with EAS Hosting",
        "source": "file",
        "location": "<HOME>/.agents/skills/expo-api-routes/SKILL.md"
    },
    {
        "name": "expo-cicd-workflows",
        "description": "Helps understand and write EAS workflow YAML files for Expo projects. Use this skill when the user asks about CI/CD or workflows in an Expo or EAS context, mentions .eas/workflows/, or wants help with EAS build pipelines or deployment automation.",
        "source": "file",
        "location": "<HOME>/.agents/skills/expo-cicd-workflows/SKILL.md"
    },
    {
        "name": "expo-deployment",
        "description": "Deploying Expo apps to iOS App Store, Android Play Store, web hosting, and API routes",
        "source": "file",
        "location": "<HOME>/.agents/skills/expo-deployment/SKILL.md"
    },
    {
        "name": "expo-dev-client",
        "description": "Build and distribute Expo development clients locally or via TestFlight",
        "source": "file",
        "location": "<HOME>/.agents/skills/expo-dev-client/SKILL.md"
    },
    {
        "name": "expo-tailwind-setup",
        "description": "Set up Tailwind CSS v4 in Expo with react-native-css and NativeWind v5 for universal styling",
        "source": "file",
        "location": "<HOME>/.agents/skills/expo-tailwind-setup/SKILL.md"
    },
    {
        "name": "find-skills",
        "description": "Helps users discover and install agent skills when they ask questions like \"how do I do X\", \"find a skill for X\", \"is there a skill that can...\", or express interest in extending capabilities. This skill should be used when the user is looking for functionality that might exist as an installable skill.",
        "source": "file",
        "location": "<HOME>/.agents/skills/find-skills/SKILL.md"
    },
    {
        "name": "frontend-design",
        "description": "Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, artifacts, posters, or applications (examples include websites, landing pages, dashboards, React components, HTML/CSS layouts, or when styling/beautifying any web UI). Generates creative, polished code and UI design that avoids generic AI aesthetics.",
        "source": "file",
        "location": "<HOME>/.agents/skills/frontend-design/SKILL.md"
    },
    {
        "name": "github:gh-address-comments",
        "description": "Address actionable GitHub pull request review feedback. Use when the user wants to inspect unresolved review threads, requested changes, or inline review comments on a PR, then implement selected fixes. Use the GitHub app for PR metadata and flat comment reads, and use the bundled GraphQL script via `gh` whenever thread-level state, resolution status, or inline review context matters.",
        "source": "file",
        "location": "/private<CAPTURE_DIRECTORY>/codex-home/plugins/cache/openai-curated-remote/github/0.1.8-2841cf9749ae/skills/gh-address-comments/SKILL.md"
    },
    {
        "name": "github:gh-fix-ci",
        "description": "Use when a user asks to debug or fix failing GitHub PR checks that run in GitHub Actions. Use the GitHub app from this plugin for PR metadata and patch context, and use `gh` for Actions check and log inspection before implementing any approved fix.",
        "source": "file",
        "location": "/private<CAPTURE_DIRECTORY>/codex-home/plugins/cache/openai-curated-remote/github/0.1.8-2841cf9749ae/skills/gh-fix-ci/SKILL.md"
    },
    {
        "name": "github:github",
        "description": "Triage and orient GitHub repository, pull request, and issue work through the connected GitHub app. Use when the user asks for general GitHub help, wants PR or issue summaries, or needs repository context before choosing a more specific GitHub workflow.",
        "source": "file",
        "location": "/private<CAPTURE_DIRECTORY>/codex-home/plugins/cache/openai-curated-remote/github/0.1.8-2841cf9749ae/skills/github/SKILL.md"
    },
    {
        "name": "github:yeet",
        "description": "Publish local changes to GitHub by confirming scope, committing intentionally, pushing the branch, and opening a draft PR through the GitHub app from this plugin, with `gh` used only as a fallback where connector coverage is insufficient.",
        "source": "file",
        "location": "/private<CAPTURE_DIRECTORY>/codex-home/plugins/cache/openai-curated-remote/github/0.1.8-2841cf9749ae/skills/yeet/SKILL.md"
    },
    {
        "name": "my-logs",
        "description": "Explain how to do logging",
        "source": "file",
        "location": "<HOME>/.agents/skills/my-logs/SKILL.md"
    },
    {
        "name": "my-plan",
        "description": "Use for planning work",
        "source": "file",
        "location": "<HOME>/.agents/skills/my-plan/SKILL.md"
    },
    {
        "name": "my-web",
        "description": "React web development conventions and patterns",
        "source": "file",
        "location": "<HOME>/.agents/skills/my-web/SKILL.md"
    },
    {
        "name": "my-web-plan",
        "description": "Planning for React web UI implementation with component design focus",
        "source": "file",
        "location": "<HOME>/.agents/skills/my-web-plan/SKILL.md"
    },
    {
        "name": "native-data-fetching",
        "description": "Use when implementing or debugging ANY network request, API call, or data fetching. Covers fetch API, React Query, SWR, error handling, caching, offline support, and Expo Router data loaders (`useLoaderData`).",
        "source": "file",
        "location": "<HOME>/.agents/skills/native-data-fetching/SKILL.md"
    },
    {
        "name": "office-hours",
        "description": "MANUAL TRIGGER ONLY: invoke only when user types /office-hours. YC Office Hours — two modes. Startup mode: six forcing questions that expose demand reality, status quo, desperate specificity, narrowest wedge, observation, and future-fit. Builder mode: design thinking brainstorming for side projects, hackathons, learning, and open source. Saves a design doc. Use when asked to \"brainstorm this\", \"I have an idea\", \"help me think through this\", \"office hours\", or \"is this worth building\". Proactively suggest when the user describes a new product idea or is exploring whether something is worth building — before any code is written.",
        "source": "file",
        "location": "<HOME>/.agents/skills/office-hours/SKILL.md"
    },
    {
        "name": "pdf",
        "description": "Use this skill whenever the user wants to do anything with PDF files. This includes reading or extracting text/tables from PDFs, combining or merging multiple PDFs into one, splitting PDFs apart, rotating pages, adding watermarks, creating new PDFs, filling PDF forms, encrypting/decrypting PDFs, extracting images, and OCR on scanned PDFs to make them searchable. If the user mentions a .pdf file or asks to produce one, use this skill.",
        "source": "file",
        "location": "<HOME>/.agents/skills/pdf/SKILL.md"
    },
    {
        "name": "pptx",
        "description": "Use this skill any time a .pptx file is involved in any way — as input, output, or both. This includes: creating slide decks, pitch decks, or presentations; reading, parsing, or extracting text from any .pptx file (even if the extracted content will be used elsewhere, like in an email or summary); editing, modifying, or updating existing presentations; combining or splitting slide files; working with templates, layouts, speaker notes, or comments. Trigger whenever the user mentions \"deck,\" \"slides,\" \"presentation,\" or references a .pptx filename, regardless of what they plan to do with the content afterward. If a .pptx file needs to be opened, created, or touched, use this skill.",
        "source": "file",
        "location": "<HOME>/.agents/skills/pptx/SKILL.md"
    },
    {
        "name": "remotion-best-practices",
        "description": "Best practices for Remotion - Video creation in React",
        "source": "file",
        "location": "<HOME>/.agents/skills/remotion-best-practices/SKILL.md"
    },
    {
        "name": "slack-gif-creator",
        "description": "Knowledge and utilities for creating animated GIFs optimized for Slack. Provides constraints, validation tools, and animation concepts. Use when users request animated GIFs for Slack like \"make me a GIF of X doing Y for Slack.\"",
        "source": "file",
        "location": "<HOME>/.agents/skills/slack-gif-creator/SKILL.md"
    },
    {
        "name": "sprint",
        "description": "Plan and execute 2-week engineering sprints with structured debate, task-by-task execution, and incremental markdown reporting. Use when asked to \"plan a sprint\", \"create a sprint\", \"execute a sprint\", \"resume a sprint\", or \"plan roadmap\". Supports pause/resume, tracks progress in markdown files as source of truth. Scans the project, proposes a plan, critiques it, synthesizes a final plan, then executes each task sequentially with review after each one.",
        "source": "file",
        "location": "<HOME>/.agents/skills/sprint/SKILL.md"
    },
    {
        "name": "theme-factory",
        "description": "Toolkit for styling artifacts with a theme. These artifacts can be slides, docs, reportings, HTML landing pages, etc. There are 10 pre-set themes with colors/fonts that you can apply to any artifact that has been creating, or can generate a new theme on-the-fly.",
        "source": "file",
        "location": "<HOME>/.agents/skills/theme-factory/SKILL.md"
    },
    {
        "name": "upgrading-expo",
        "description": "Guidelines for upgrading Expo SDK versions and fixing dependency issues",
        "source": "file",
        "location": "<HOME>/.agents/skills/upgrading-expo/SKILL.md"
    },
    {
        "name": "use-dom",
        "description": "Use Expo DOM components to run web code in a webview on native and as-is on web. Migrate web code to native incrementally.",
        "source": "file",
        "location": "<HOME>/.agents/skills/use-dom/SKILL.md"
    },
    {
        "name": "web-artifacts-builder",
        "description": "Suite of tools for creating elaborate, multi-component claude.ai HTML artifacts using modern frontend web technologies (React, Tailwind CSS, shadcn/ui). Use for complex artifacts requiring state management, routing, or shadcn/ui components - not for simple single-file HTML/JSX artifacts.",
        "source": "file",
        "location": "<HOME>/.agents/skills/web-artifacts-builder/SKILL.md"
    },
    {
        "name": "webapp-testing",
        "description": "Toolkit for interacting with and testing local web applications using Playwright. Supports verifying frontend functionality, debugging UI behavior, capturing browser screenshots, and viewing browser logs.",
        "source": "file",
        "location": "<HOME>/.agents/skills/webapp-testing/SKILL.md"
    },
    {
        "name": "xlsx",
        "description": "Use this skill any time a spreadsheet file is the primary input or output. This means any task where the user wants to: open, read, edit, or fix an existing .xlsx, .xlsm, .csv, or .tsv file (e.g., adding columns, computing formulas, formatting, charting, cleaning messy data); create a new spreadsheet from scratch or from other data sources; or convert between tabular file formats. Trigger especially when the user references a spreadsheet file by name or path — even casually (like \"the xlsx in my downloads\") — and wants something done to it or produced from it. Also trigger for cleaning or restructuring messy tabular data files (malformed rows, misplaced headers, junk data) into proper spreadsheets. The deliverable must be a spreadsheet file. Do NOT trigger when the primary deliverable is a Word document, HTML report, standalone Python script, database pipeline, or Google Sheets API integration, even if tabular data is involved.",
        "source": "file",
        "location": "<HOME>/.agents/skills/xlsx/SKILL.md"
    }
] as const satisfies readonly SessionSkill[];
