import type { IncomingMessage, ServerResponse } from "node:http";

import { readAdminLogin, requireAdminRequest } from "../../lib/adminRequest";

import { appendClaAuditEvent } from "../../lib/claAudit";
import { allowResubmit } from "../../lib/claQueue";
import { sendJson } from "../../lib/nodeHttp";

export default async function handler(
    req: IncomingMessage,
    res: ServerResponse,
): Promise<void> {
    const session = await requireAdminRequest(req, res, "POST");
    if (!session) return;

    const login = await readAdminLogin(req, res);
    if (!login) return;

    const ok = await allowResubmit(login);
    if (!ok) {
        sendJson(res, 404, { error: "not_rejected" });
        return;
    }

    const at = new Date().toISOString();
    void appendClaAuditEvent({
        kind: "allow_resubmit",
        at,
        login,
        actor: session.login,
    }).catch((err: unknown) => {
        console.error("cla_audit", err);
    });

    sendJson(res, 200, { ok: true, login });
}
