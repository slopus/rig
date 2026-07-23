export interface CodexCompactionMetadata {
    readonly trigger: "manual";
    readonly reason: "user_requested";
    readonly implementation: "responses" | "responses_compaction_v2";
    readonly phase: "standalone_turn";
    readonly strategy: "memento";
}
