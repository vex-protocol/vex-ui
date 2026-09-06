import type { IncomingMessage, ServerResponse } from "node:http";

import { requireAdminRequest } from "../../lib/adminRequest";

import {
    getClabotRepoFullNames,
    getClaSdkVersion,
    getClaSourceRepoFullName,
} from "../../lib/claConfig";
import { readQueue } from "../../lib/claQueue";
import { sendJson } from "../../lib/nodeHttp";

export default async function handler(
    req: IncomingMessage,
    res: ServerResponse,
): Promise<void> {
    const session = await requireAdminRequest(req, res, "GET");
    if (!session) return;

    const q = await readQueue();
    sendJson(res, 200, {
        pending: q.pending,
        rejected: q.rejected,
        resubmitAllowed: q.resubmitAllowed,
        sourceRepo: getClaSourceRepoFullName(),
        clabotRepos: getClabotRepoFullNames(),
        claVersion: getClaSdkVersion(),
    });
}
