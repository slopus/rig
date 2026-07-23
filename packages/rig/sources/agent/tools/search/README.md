# Tool definition search implementation

`searchToolDefinitions` accepts tools created by `defineTool` and returns the same tool objects in
ranked order. It is intentionally isolated and is not connected to Rig's agent loop.

The implementation follows Codex's tool-search behavior:

- Build searchable text from namespace metadata, the tool name (both original and
  underscore-separated), its description, and parameter names/descriptions recursively.
- When a definition supplies `searchText`, use it as the complete custom search text instead,
  matching Codex's explicit `search_text` path.
- Normalize English text with ASCII transliteration, Unicode word segmentation, English stop-word
  removal, and Porter stemming.
- Rank matching definitions with BM25 using Codex's `k1 = 1.2` and `b = 0.75` parameters.
- Exclude zero-score definitions, preserve input order for tied scores, and return the original tool
  definition objects.

The public function is in `../searchToolDefinitions.ts`. Integration, provider conversion,
namespace coalescing, and deferred-loading state are deliberately out of scope for this isolated
copy.
