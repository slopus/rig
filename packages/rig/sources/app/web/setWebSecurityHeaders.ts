import type { ServerResponse } from "node:http";

export const webSecurityHeaderNames = [
    "content-security-policy",
    "cross-origin-opener-policy",
    "cross-origin-resource-policy",
    "permissions-policy",
    "referrer-policy",
    "x-content-type-options",
    "x-frame-options",
] as const;

const contentSecurityPolicy = [
    "default-src 'none'",
    "base-uri 'none'",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "img-src data: blob:",
    "manifest-src 'self'",
    "media-src 'none'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
].join("; ");

export function setWebSecurityHeaders(response: ServerResponse): void {
    response.setHeader("content-security-policy", contentSecurityPolicy);
    response.setHeader("cross-origin-opener-policy", "same-origin");
    response.setHeader("cross-origin-resource-policy", "same-origin");
    response.setHeader(
        "permissions-policy",
        "camera=(), display-capture=(), geolocation=(), microphone=(), payment=(), usb=()",
    );
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("x-frame-options", "DENY");
}
