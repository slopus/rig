import type { SessionContext } from "@/core/SessionContext.js";
import type { SessionModelConfiguration } from "@/core/SessionModelConfiguration.js";
import type { SessionSkillsOptions } from "@/core/SessionSkill.js";
import type { SessionToolsOptions } from "@/core/SessionTool.js";

/** Immutable model-visible configuration and initial history for a session. */
export interface SessionOptions extends SessionSkillsOptions, SessionToolsOptions {
    readonly context: SessionContext;
    /**
     * Alternate model-visible configurations supplied when a session can switch between
     * models whose instructions, skills, or tools differ.
     */
    readonly modelConfigurations?: Readonly<Record<string, SessionModelConfiguration>>;
}
