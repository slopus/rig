export interface WebSearchHit {
    title: string;
    url: string;
}

export interface WebSearchResult {
    tool_use_id: string;
    content: WebSearchHit[];
}

export interface WebSearchOutput {
    query: string;
    results: Array<WebSearchResult | string>;
    durationSeconds: number;
}

export interface WebSearchInput {
    query: string;
    allowed_domains?: string[];
    blocked_domains?: string[];
}
