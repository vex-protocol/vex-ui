import type { IncomingMessage, ServerResponse } from "node:http";

import { isClaAdmin } from "./adminAuth";
import { getSessionSecret } from "./ghOAuthEnv";
import { readGithubSession, type GithubSessionPayload } from "./ghSession";
import { readJsonBody, sendJson, sendJsonBodyError } from "./nodeHttp";

/** Authenticate each request before reading or mutating the admin queue. */
export async function requireAdminRequest(
    req: IncomingMessage,
    res: ServerResponse,
    method: "GET" | "POST",
): Promise<GithubSessionPayload | null> {
    if (req.method !== method) {
        res.statusCode = 405;
        res.setHeader("Allow", method);
        res.end("Method Not Allowed");
        return null;
    }
    const secret = getSessionSecret();
    if (!secret) {
        sendJson(res, 503, { error: "not_configured" });
        return null;
    }
    const session = readGithubSession(req, secret);
    if (!session) {
        sendJson(res, 401, { error: "not_signed_in" });
        return null;
    }
    if (!(await isClaAdmin(session.login, session.oauth_access_token))) {
        sendJson(res, 403, { error: "forbidden" });
        return null;
    }
    return session;
}

export async function readAdminLogin(
    req: IncomingMessage,
    res: ServerResponse,
): Promise<string | null> {
    let body: unknown;
    try {
        body = await readJsonBody(req);
    } catch (cause) {
        sendJsonBodyError(res, cause);
        return null;
    }
    const login =
        body !== null &&
        typeof body === "object" &&
        "login" in body &&
        typeof body.login === "string"
            ? body.login.trim()
            : "";
    if (!login || login.length > 39 || /[^a-zA-Z0-9-]/u.test(login)) {
        sendJson(res, 400, { error: "invalid_login" });
        return null;
    }
    return login;
}
