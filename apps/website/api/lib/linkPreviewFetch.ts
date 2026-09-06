import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";

const HTML_LIMIT = 512 * 1024;
const REDIRECT_LIMIT = 4;
const TIMEOUT_MS = 8_000;
const URL_LIMIT = 2_048;

interface ResolvedAddress {
    address: string;
    family: 4 | 6;
}

interface RequestHtmlResult {
    html?: string;
    redirect?: string;
}

export interface LinkPreviewHtmlResult {
    finalUrl: string;
    html: string;
}

const { ipv4: blockedIPv4, ipv6: blockedIPv6 } = buildBlockedAddresses();

export class PreviewTargetError extends Error {}

export async function fetchPublicPreviewHtml(
    value: string | URL,
): Promise<LinkPreviewHtmlResult> {
    let current = validatePreviewURL(value);
    for (let redirects = 0; redirects <= REDIRECT_LIMIT; redirects++) {
        const addresses = await resolvePublicAddresses(current);
        const response = await requestHtml(current, addresses[0]);
        if (response.redirect) {
            if (redirects === REDIRECT_LIMIT) {
                throw new PreviewTargetError("Too many preview redirects");
            }
            current = validatePreviewURL(
                new URL(response.redirect, current).toString(),
            );
            continue;
        }
        return {
            finalUrl: current.toString(),
            html: response.html ?? "",
        };
    }
    throw new PreviewTargetError("Too many preview redirects");
}

export function isPublicPreviewAddress(
    address: string,
    family = isIP(address),
): boolean {
    if (family !== 4 && family !== 6) return false;
    return family === 6
        ? !blockedIPv6.check(address, "ipv6")
        : !blockedIPv4.check(address, "ipv4");
}

export function validatePreviewURL(value: string | URL): URL {
    let url: URL;
    try {
        url = new URL(value.toString());
    } catch {
        throw new PreviewTargetError("Invalid preview URL");
    }
    if (
        !["http:", "https:"].includes(url.protocol) ||
        !url.hostname ||
        url.username ||
        url.password ||
        url.toString().length > URL_LIMIT
    ) {
        throw new PreviewTargetError("Invalid preview URL");
    }

    const hostname = normalizeHostname(url.hostname).toLowerCase();
    if (isBlockedHostname(hostname)) {
        throw new PreviewTargetError("Preview target is not allowed");
    }
    const family = isIP(hostname);
    if (family && !isPublicPreviewAddress(hostname, family)) {
        throw new PreviewTargetError("Preview target is not allowed");
    }

    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    if (!["80", "443"].includes(port)) {
        throw new PreviewTargetError("Preview target port is not allowed");
    }
    url.hash = "";
    return url;
}

async function resolvePublicAddresses(url: URL): Promise<ResolvedAddress[]> {
    const hostname = normalizeHostname(url.hostname);
    const literalFamily = isIP(hostname);
    let addresses: ResolvedAddress[];
    try {
        if (literalFamily === 4 || literalFamily === 6) {
            addresses = [{ address: hostname, family: literalFamily }];
        } else {
            const resolved = await lookup(hostname, {
                all: true,
                verbatim: true,
            });
            addresses = [];
            for (const { address, family } of resolved) {
                if (family === 4) addresses.push({ address, family: 4 });
                if (family === 6) addresses.push({ address, family: 6 });
            }
        }
    } catch {
        throw new PreviewTargetError("Preview target could not be resolved");
    }
    if (
        addresses.length === 0 ||
        addresses.some(
            ({ address, family }) => !isPublicPreviewAddress(address, family),
        )
    ) {
        throw new PreviewTargetError("Preview target is not allowed");
    }
    return addresses;
}

function requestHtml(
    url: URL,
    address: ResolvedAddress | undefined,
): Promise<RequestHtmlResult> {
    if (!address) {
        return Promise.reject(
            new PreviewTargetError("Preview target is not allowed"),
        );
    }
    return new Promise((resolve, reject) => {
        let settled = false;
        const resolveOnce = (value: RequestHtmlResult): void => {
            if (settled) return;
            settled = true;
            clearTimeout(deadline);
            resolve(value);
        };
        const rejectOnce = (cause: unknown): void => {
            if (settled) return;
            settled = true;
            clearTimeout(deadline);
            reject(cause);
        };
        const transport = url.protocol === "https:" ? https : http;
        const request = transport.get(
            {
                family: address.family,
                headers: {
                    Accept: "text/html,application/xhtml+xml;q=0.9",
                    "Accept-Encoding": "identity",
                    Host: url.host,
                    "User-Agent": "Vex/0.1 link-preview",
                },
                hostname: address.address,
                path: `${url.pathname}${url.search}`,
                port: url.port || (url.protocol === "https:" ? 443 : 80),
                protocol: url.protocol,
                servername: isIP(normalizeHostname(url.hostname))
                    ? undefined
                    : normalizeHostname(url.hostname),
                timeout: TIMEOUT_MS,
            },
            (response) => {
                const status = response.statusCode ?? 0;
                if (status >= 300 && status < 400) {
                    const location = response.headers.location;
                    response.destroy();
                    if (!location) {
                        rejectOnce(
                            new PreviewTargetError("Invalid preview redirect"),
                        );
                        return;
                    }
                    resolveOnce({ redirect: location });
                    return;
                }
                if (status < 200 || status >= 300) {
                    response.destroy();
                    rejectOnce(
                        new Error(`Preview request failed with ${status}`),
                    );
                    return;
                }

                const contentEncoding = (
                    response.headers["content-encoding"] ?? "identity"
                ).toLowerCase();
                if (contentEncoding !== "identity") {
                    response.destroy();
                    rejectOnce(
                        new Error("Compressed previews are not allowed"),
                    );
                    return;
                }
                const contentType = (
                    response.headers["content-type"] ?? ""
                ).toLowerCase();
                if (
                    contentType &&
                    !contentType.includes("text/html") &&
                    !contentType.includes("application/xhtml+xml")
                ) {
                    response.destroy();
                    rejectOnce(new Error("Preview target is not HTML"));
                    return;
                }

                const declaredLength = Number(
                    response.headers["content-length"] ?? "0",
                );
                if (
                    Number.isFinite(declaredLength) &&
                    declaredLength > HTML_LIMIT
                ) {
                    response.destroy();
                    rejectOnce(new Error("Preview response is too large"));
                    return;
                }

                const chunks: Buffer[] = [];
                let bytes = 0;
                response.on("data", (chunk: Buffer | string) => {
                    if (settled) return;
                    const buffer = Buffer.isBuffer(chunk)
                        ? chunk
                        : Buffer.from(chunk);
                    const remaining = HTML_LIMIT - bytes;
                    chunks.push(buffer.subarray(0, remaining));
                    bytes += Math.min(buffer.length, remaining);
                    if (bytes === HTML_LIMIT) {
                        resolveOnce({
                            html: Buffer.concat(chunks).toString("utf8"),
                        });
                        response.destroy();
                    }
                });
                response.on("end", () => {
                    resolveOnce({
                        html: Buffer.concat(chunks).toString("utf8"),
                    });
                });
                response.on("error", rejectOnce);
            },
        );
        // Socket inactivity timeouts alone let a peer trickle bytes forever.
        const deadline = setTimeout(() => {
            request.destroy(new Error("Preview request timed out"));
        }, TIMEOUT_MS);
        request.on("timeout", () => {
            request.destroy(new Error("Preview request timed out"));
        });
        request.on("error", rejectOnce);
    });
}

function isBlockedHostname(hostname: string): boolean {
    return (
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname.endsWith(".local") ||
        hostname.endsWith(".internal") ||
        hostname.endsWith(".lan") ||
        hostname === "home.arpa" ||
        hostname.endsWith(".home.arpa")
    );
}

function normalizeHostname(hostname: string): string {
    return hostname.replace(/^\[/u, "").replace(/\]$/u, "").replace(/\.$/u, "");
}

function buildBlockedAddresses(): { ipv4: BlockList; ipv6: BlockList } {
    const ipv4 = new BlockList();
    const ipv6 = new BlockList();
    for (const [network, prefix] of [
        ["0.0.0.0", 8],
        ["10.0.0.0", 8],
        ["100.64.0.0", 10],
        ["127.0.0.0", 8],
        ["169.254.0.0", 16],
        ["172.16.0.0", 12],
        ["192.0.0.0", 24],
        ["192.0.2.0", 24],
        ["192.168.0.0", 16],
        ["198.18.0.0", 15],
        ["198.51.100.0", 24],
        ["203.0.113.0", 24],
        ["224.0.0.0", 4],
        ["240.0.0.0", 4],
    ] as const) {
        ipv4.addSubnet(network, prefix, "ipv4");
    }
    for (const [network, prefix] of [
        ["::", 128],
        ["::1", 128],
        ["::ffff:0:0", 96],
        ["64:ff9b::", 96],
        ["64:ff9b:1::", 48],
        ["100::", 64],
        ["2001::", 23],
        ["2001:db8::", 32],
        ["2002::", 16],
        ["fc00::", 7],
        ["fe80::", 10],
        ["fec0::", 10],
        ["ff00::", 8],
    ] as const) {
        ipv6.addSubnet(network, prefix, "ipv6");
    }
    return { ipv4, ipv6 };
}
