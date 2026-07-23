import type { ExecutorModelProfile } from "@/ExecutorModelProfile.js";
import type { ExecutorEnvironment } from "@/prompts/ExecutorEnvironment.js";

export function assembleEnvironmentPrompt(options: {
    environment: ExecutorEnvironment;
    profiles: readonly ExecutorModelProfile[];
}): string {
    const { environment } = options;
    return [
        "# Environment",
        `- Primary working directory: ${environment.primaryWorkingDirectory}`,
        `- Platform: ${environment.platform}`,
        `- Shell: ${environment.shell}`,
        `- OS version: ${environment.osVersion}`,
        "",
        "## Available models",
        ...options.profiles.map(
            (profile) =>
                `- ${profile.name} — model ID: \`${profile.id}\`; provider ID: \`${profile.providerId}\``,
        ),
    ].join("\n");
}
