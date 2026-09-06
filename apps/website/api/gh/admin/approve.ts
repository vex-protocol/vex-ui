import type { IncomingMessage, ServerResponse } from "node:http";

import { readAdminLogin, requireAdminRequest } from "../../lib/adminRequest";

import { appendClaAuditEvent } from "../../lib/claAudit";
import { addCompleted, readQueue, removePending } from "../../lib/claQueue";
import {
    addContributorToClabotRepo,
    parseRepoList,
} from "../../lib/updateClabot";
import { sendJson } from "../../lib/nodeHttp";

export default async function handler(
    req: IncomingMessage,
    res: ServerResponse,
): Promise<void> {
    const session = await requireAdminRequest(req, res, "POST");
    if (!session) return;

    const login = await readAdminLogin(req, res);
    if (!login) return;

    const q = await readQueue();
    const row = q.pending.find(
        (p) => p.login.toLowerCase() === login.toLowerCase(),
    );
    if (!row) {
        sendJson(res, 404, { error: "not_in_queue" });
        return;
    }

    const botToken = process.env.GITHUB_CLA_BOT_TOKEN?.trim();
    const repos = parseRepoList(process.env.CLA_BOT_REPOS);

    const github: Array<{
        repo: string;
        ok: boolean;
        skipped?: boolean;
        error?: string;
    }> = [];

    if (botToken && repos.length > 0) {
        for (const { owner, repo } of repos) {
            const result = await addContributorToClabotRepo(
                botToken,
                owner,
                repo,
                login,
            );
            if (result.ok) {
                github.push({
                    repo: result.repo,
                    ok: true,
                    skipped: result.skipped,
                });
            } else {
                github.push({
                    repo: result.repo,
                    ok: false,
                    error: result.error,
                });
            }
        }
        const failed = github.filter((g) => !g.ok);
        if (failed.length > 0) {
            sendJson(res, 502, {
                error: "github_update_failed",
                login,
                github,
            });
            return;
        }
    }

    const removed = await removePending(login);
    if (!removed) {
        sendJson(res, 409, { error: "queue_race" });
        return;
    }

    await addCompleted({
        login: row.login,
        at: row.at,
        claVersion: row.claVersion,
    });

    const approvedAt = new Date().toISOString();
    void appendClaAuditEvent({
        kind: "approve",
        at: approvedAt,
        login: row.login,
        actor: session.login,
        claVersion: row.claVersion,
    }).catch((err: unknown) => {
        console.error("cla_audit", err);
    });

    sendJson(res, 200, {
        ok: true,
        login,
        github,
        note:
            github.length === 0
                ? "Set GITHUB_CLA_BOT_TOKEN and CLA_BOT_REPOS to commit .clabot automatically."
                : undefined,
    });
}
