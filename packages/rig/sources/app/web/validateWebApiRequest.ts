import type { IncomingMessage } from "node:http";

interface WebHost {
    hostname: string;
    port: number | undefined;
}

export function validateWebApiRequest(request: IncomingMessage): string | undefined {
    if (!isLoopbackAddress(request.socket.remoteAddress)) {
        return "Rig rejected this API request because the web control surface is available only from this machine.";
    }

    const forwardedFor = request.headersDistinct["x-forwarded-for"];
    if (
        forwardedFor !== undefined &&
        (forwardedFor.length !== 1 ||
            !forwardedFor[0]?.split(",").every((address) => isLoopbackAddress(address.trim())))
    ) {
        return "Rig rejected this API request because it was forwarded from another machine.";
    }

    const hostValues = request.headersDistinct.host;
    if (hostValues === undefined || hostValues.length !== 1) {
        return "Rig rejected this API request because it did not use a trusted local address.";
    }

    const hostValue = hostValues[0];
    const host = hostValue === undefined ? undefined : parseWebHost(hostValue);
    if (host === undefined || !isTrustedWebHostname(host.hostname)) {
        return "Rig rejected this API request because it did not use a trusted local address.";
    }

    const fetchSiteValues = request.headersDistinct["sec-fetch-site"];
    if (
        (fetchSiteValues !== undefined && fetchSiteValues.length !== 1) ||
        fetchSiteValues?.[0]?.toLowerCase() === "cross-site"
    ) {
        return "Rig rejected this API request because it came from another site.";
    }

    const originValues = request.headersDistinct.origin;
    if (originValues !== undefined && originValues.length !== 1) {
        return "Rig rejected this API request because its browser origin could not be verified.";
    }

    const origin = originValues?.[0];
    if (origin !== undefined && !isSameWebOrigin(origin, host)) {
        return "Rig rejected this API request because it came from another site.";
    }

    if (isStateChangingMethod(request.method) && origin === undefined) {
        return "Rig rejected this API request because its browser origin could not be verified.";
    }

    return undefined;
}

function isLoopbackAddress(address: string | undefined): boolean {
    if (address === undefined) return false;
    const normalized = address.toLowerCase();
    return normalized === "127.0.0.1" || normalized === "::1" || normalized === "::ffff:127.0.0.1";
}

function parseWebHost(value: string): WebHost | undefined {
    const authorityMatch = value.startsWith("[")
        ? /^\[[^\]]+\](?::([0-9]+))?$/.exec(value)
        : /^[^:]+(?::([0-9]+))?$/.exec(value);
    if (authorityMatch === null) {
        return undefined;
    }

    try {
        const parsed = new URL(`http://${value}`);
        const port = authorityMatch[1] === undefined ? undefined : Number(authorityMatch[1]);
        if (
            parsed.username !== "" ||
            parsed.password !== "" ||
            parsed.pathname !== "/" ||
            parsed.search !== "" ||
            parsed.hash !== "" ||
            (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65_535))
        ) {
            return undefined;
        }
        return { hostname: normalizeHostname(parsed.hostname), port };
    } catch {
        return undefined;
    }
}

function isTrustedWebHostname(hostname: string): boolean {
    return (
        hostname === "web.rig.localhost" ||
        hostname === "localhost" ||
        hostname === "[::1]" ||
        hostname === "127.0.0.1"
    );
}

function isSameWebOrigin(value: string, host: WebHost): boolean {
    let origin: URL;
    try {
        origin = new URL(value);
    } catch {
        return false;
    }

    if (
        (origin.protocol !== "http:" && origin.protocol !== "https:") ||
        origin.username !== "" ||
        origin.password !== "" ||
        origin.pathname !== "/" ||
        origin.search !== "" ||
        origin.hash !== "" ||
        normalizeHostname(origin.hostname) !== host.hostname
    ) {
        return false;
    }

    if (host.port === undefined) {
        return origin.port === "";
    }

    const originPort =
        origin.port === "" ? (origin.protocol === "https:" ? 443 : 80) : Number(origin.port);
    return originPort === host.port;
}

function normalizeHostname(hostname: string): string {
    return hostname.toLowerCase().replace(/\.$/, "");
}

function isStateChangingMethod(method: string | undefined): boolean {
    return method !== "GET" && method !== "HEAD";
}
