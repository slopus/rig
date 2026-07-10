export function isPermittedWebFetchRedirect(originalUrl: string, redirectUrl: string): boolean {
    try {
        const original = new URL(originalUrl);
        const redirect = new URL(redirectUrl);
        if (redirect.protocol !== original.protocol || redirect.port !== original.port) {
            return false;
        }
        if (redirect.username || redirect.password) {
            return false;
        }

        const originalHostname = original.hostname.replace(/^www\./, "");
        const redirectHostname = redirect.hostname.replace(/^www\./, "");
        return originalHostname === redirectHostname;
    } catch {
        return false;
    }
}
