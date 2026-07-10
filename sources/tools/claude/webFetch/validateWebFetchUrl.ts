const MAX_URL_LENGTH = 2000;

export function validateWebFetchUrl(url: string): boolean {
    if (url.length > MAX_URL_LENGTH) {
        return false;
    }

    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return false;
        }
        if (parsed.username || parsed.password) {
            return false;
        }
        return parsed.hostname.split(".").length >= 2;
    } catch {
        return false;
    }
}
