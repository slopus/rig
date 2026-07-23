# Requirements

- Always use native compaction when possible, do not make compaction yourself
- Always capture real life traces and compare against them, run real inference
- When writing golden tests - do not synthesize from golden input output data, all prompts, skills, tools definitions must be defined in the vendor folder with a typescript code. Parameters are typed with typebox only, not raw json object with "as unknown".
- Low level mechanics of networking is very important, it should be exactly as it should be
- Retries are owned by the provider, not outer code. This package-level requirement overrides the
  repository default whenever a native provider retries after output begins; the provider must
  expose and test rollback so replay cannot duplicate visible output or tool effects.
- Providers are strippable to the barebone but can be reconstructed back to match native implementations
- No automatic compaction inside - only manual one, outer code decides when to compact.
- Must carefuly reproduce retry logic, headers, fallbacks, everything of the native client
- Keep connections alive, prompt cache alive, not non-deterministically shuffle context
