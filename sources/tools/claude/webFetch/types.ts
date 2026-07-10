export interface WebFetchRedirect {
    type: "redirect";
    originalUrl: string;
    redirectUrl: string;
    statusCode: number;
}

export interface WebFetchContent {
    bytes: number;
    code: number;
    codeText: string;
    content: string;
    contentType: string;
    persistedPath?: string;
    persistedSize?: number;
}

export type WebFetchResponse = WebFetchContent | WebFetchRedirect;
