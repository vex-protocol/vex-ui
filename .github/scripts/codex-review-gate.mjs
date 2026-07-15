import { pathToFileURL } from "node:url";

const CODEX_LOGIN = "chatgpt-codex-connector";
const COMMENT_MARKER = "<!-- codex-review-gate -->";
const DEFAULT_INTERVAL_MS = 15_000;
const DEFAULT_RETRY_MS = 20 * 60_000;
const DEFAULT_TIMEOUT_MS = 40 * 60_000;
const REVIEW_ACK_MARKER = "codex-review-acknowledged";
const REVIEW_REQUEST_MARKER = "codex-review-request";
const STATUS_CONTEXT_PREFIX = "Codex Review";
const TARGET_BRANCHES = new Set(["development", "master"]);

const REVIEW_QUERY = `
query CodexReviewGate($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      baseRefName
      headRefOid
      isDraft
      reactions(first: 50) {
        nodes {
          content
          createdAt
          user {
            login
          }
        }
      }
      reviews(last: 50) {
        nodes {
          author {
            login
          }
          commit {
            oid
          }
          comments {
            totalCount
          }
          submittedAt
        }
      }
      comments(last: 100) {
        nodes {
          author {
            login
          }
          body
          createdAt
          databaseId
          updatedAt
          reactions(first: 50) {
            nodes {
              content
              createdAt
              user {
                login
              }
            }
          }
        }
      }
    }
  }
}`;

function normalizedLogin(login) {
    return String(login ?? "")
        .toLowerCase()
        .replace(/\[bot\]$/, "");
}

function isCodex(login) {
    return normalizedLogin(login) === CODEX_LOGIN;
}

function isGitHubActions(login) {
    return normalizedLogin(login) === "github-actions";
}

function isThumbsUp(content) {
    return content === "THUMBS_UP" || content === "+1";
}

function isEyes(content) {
    return content === "EYES" || content === "eyes";
}

function reviewRequestMarker(headSha, baseRef) {
    return `<!-- ${REVIEW_REQUEST_MARKER}:${baseRef}:${headSha} -->`;
}

function reviewAcknowledgementMarker(headSha, baseRef) {
    return `<!-- ${REVIEW_ACK_MARKER}:${baseRef}:${headSha} -->`;
}

export function statusContext(baseRef) {
    return `${STATUS_CONTEXT_PREFIX} / ${baseRef}`;
}

function isLgtmForScope(body, headSha, baseRef) {
    const normalizedBody = String(body ?? "").toLowerCase();
    return (
        /^\s*LGTM\b/i.test(normalizedBody) &&
        (normalizedBody.includes(headSha.toLowerCase()) ||
            normalizedBody.includes(headSha.slice(0, 10).toLowerCase())) &&
        normalizedBody.includes(`target branch: ${baseRef}`.toLowerCase())
    );
}

function trustedReviewRequests(pullRequest, headSha, baseRef) {
    const marker = reviewRequestMarker(headSha, baseRef);
    return (pullRequest.comments?.nodes ?? [])
        .filter(
            (comment) =>
                isGitHubActions(comment.author?.login) &&
                comment.body?.includes(marker) &&
                Number.isFinite(Date.parse(comment.createdAt ?? "")),
        )
        .sort(
            (left, right) =>
                Date.parse(left.createdAt) - Date.parse(right.createdAt),
        );
}

export function trustedReviewRequest(pullRequest, headSha, baseRef) {
    return trustedReviewRequests(pullRequest, headSha, baseRef).at(0);
}

function hasCodexEyes(reactions) {
    return (reactions?.nodes ?? []).some(
        (reaction) => isCodex(reaction.user?.login) && isEyes(reaction.content),
    );
}

function hasRecentCodexEyes(reactions, now, activeWindowMs) {
    return (reactions?.nodes ?? []).some((reaction) => {
        const createdAt = Date.parse(reaction.createdAt ?? "");
        return (
            isCodex(reaction.user?.login) &&
            isEyes(reaction.content) &&
            Number.isFinite(createdAt) &&
            createdAt >= now - activeWindowMs
        );
    });
}

export function hasActiveCodexReview(
    pullRequest,
    headSha,
    baseRef,
    now = Date.now(),
    activeWindowMs = DEFAULT_RETRY_MS,
) {
    return (
        hasRecentCodexEyes(pullRequest.reactions, now, activeWindowMs) ||
        trustedReviewRequests(pullRequest, headSha, baseRef).some((request) =>
            hasRecentCodexEyes(request.reactions, now, activeWindowMs),
        )
    );
}

function isAcknowledgedRequest(request, headSha, baseRef) {
    return request.body?.includes(
        reviewAcknowledgementMarker(headSha, baseRef),
    );
}

export function shouldRequestReview(
    pullRequest,
    headSha,
    baseRef,
    now,
    retryMs,
) {
    const latest = trustedReviewRequests(pullRequest, headSha, baseRef).at(-1);
    return !latest || now - Date.parse(latest.createdAt) >= retryMs;
}

export function evaluateReviewState(
    pullRequest,
    expectedHeadSha,
    expectedBaseRef,
    now = Date.now(),
    activeWindowMs = DEFAULT_RETRY_MS,
) {
    if (
        !pullRequest ||
        pullRequest.headRefOid !== expectedHeadSha ||
        pullRequest.baseRefName !== expectedBaseRef
    ) {
        return {
            kind: "pending",
            reason: "The pull request review scope changed.",
        };
    }

    const requests = trustedReviewRequests(
        pullRequest,
        expectedHeadSha,
        expectedBaseRef,
    );
    if (requests.length === 0) {
        return {
            kind: "pending",
            reason: "A trusted Codex review request has not been posted yet.",
        };
    }
    const requestCreatedAt = Date.parse(requests[0].createdAt);

    const signals = [];

    for (const review of pullRequest.reviews?.nodes ?? []) {
        if (
            !isCodex(review.author?.login) ||
            review.commit?.oid !== expectedHeadSha ||
            (Date.parse(review.submittedAt ?? "") || 0) < requestCreatedAt
        ) {
            continue;
        }
        const findingCount = review.comments?.totalCount ?? 0;
        if (findingCount === 0) {
            continue;
        }
        signals.push({
            at: Date.parse(review.submittedAt ?? "") || 0,
            findingCount,
            kind: findingCount > 0 ? "findings" : "clean",
            source: "review",
        });
    }

    for (const comment of pullRequest.comments?.nodes ?? []) {
        if (
            isCodex(comment.author?.login) &&
            isLgtmForScope(comment.body, expectedHeadSha, expectedBaseRef) &&
            (Date.parse(comment.createdAt ?? "") || 0) >= requestCreatedAt
        ) {
            signals.push({
                at: Date.parse(comment.createdAt ?? "") || 0,
                findingCount: 0,
                kind: "clean",
                source: "codex-comment",
            });
        }
    }

    for (const request of requests) {
        for (const reaction of request.reactions?.nodes ?? []) {
            const reactionCreatedAt = Date.parse(reaction.createdAt ?? "");
            if (
                isCodex(reaction.user?.login) &&
                isThumbsUp(reaction.content) &&
                Number.isFinite(reactionCreatedAt) &&
                reactionCreatedAt >= Date.parse(request.createdAt)
            ) {
                signals.push({
                    at: reactionCreatedAt,
                    findingCount: 0,
                    kind: "clean",
                    source: "review-request-reaction",
                });
            }
        }
    }

    const hasActiveScopedRequest = requests.some((request) =>
        hasRecentCodexEyes(request.reactions, now, activeWindowMs),
    );
    const acknowledgedRequest = hasActiveScopedRequest
        ? undefined
        : requests
              .filter((request) =>
                  isAcknowledgedRequest(
                      request,
                      expectedHeadSha,
                      expectedBaseRef,
                  ),
              )
              .at(-1);
    if (acknowledgedRequest) {
        const acknowledgedAt = Date.parse(
            acknowledgedRequest.updatedAt ?? acknowledgedRequest.createdAt,
        );
        for (const reaction of pullRequest.reactions?.nodes ?? []) {
            const reactionCreatedAt = Date.parse(reaction.createdAt ?? "");
            if (
                isCodex(reaction.user?.login) &&
                isThumbsUp(reaction.content) &&
                Number.isFinite(reactionCreatedAt) &&
                reactionCreatedAt >= acknowledgedAt
            ) {
                signals.push({
                    at: reactionCreatedAt,
                    findingCount: 0,
                    kind: "clean",
                    source: "pull-request-reaction",
                });
            }
        }
    }

    signals.sort((left, right) => left.at - right.at);
    const latestFinding = signals
        .filter((signal) => signal.kind === "findings")
        .at(-1);
    return (
        latestFinding ??
        signals.at(-1) ?? {
            kind: "pending",
            reason: "Codex has not reviewed the current head commit yet.",
        }
    );
}

async function githubRequest(path, options = {}) {
    const response = await fetch(`https://api.github.com${path}`, {
        ...options,
        headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${requiredEnv("GH_TOKEN")}`,
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
            ...options.headers,
        },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(
            `GitHub API ${response.status}: ${body.message ?? response.statusText}`,
        );
    }
    return body;
}

async function fetchPullRequest(owner, name, number) {
    const response = await githubRequest("/graphql", {
        method: "POST",
        body: JSON.stringify({
            query: REVIEW_QUERY,
            variables: { owner, name, number },
        }),
    });
    if (response.errors?.length) {
        throw new Error(
            `GitHub GraphQL: ${response.errors.map(({ message }) => message).join("; ")}`,
        );
    }
    const pullRequest = response.data?.repository?.pullRequest;
    if (!pullRequest) {
        throw new Error(`Pull request #${number} was not found.`);
    }
    return pullRequest;
}

function requiredEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable ${name}.`);
    }
    return value;
}

function positiveIntegerEnv(name, fallback) {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer.`);
    }
    return value;
}

function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function gateCommentBody(repository, headSha, baseRef) {
    const shortSha = headSha.slice(0, 7);
    return `LGTM\n\n${COMMENT_MARKER}\nCodex reviewed [\`${shortSha}\`](https://github.com/${repository}/commit/${headSha}) against \`${baseRef}\` and reported no actionable findings.`;
}

function existingGateComment(pullRequest) {
    return (pullRequest.comments?.nodes ?? []).find(
        (comment) =>
            isGitHubActions(comment.author?.login) &&
            comment.body?.includes(COMMENT_MARKER),
    );
}

async function publishGateComment(
    repository,
    number,
    pullRequest,
    body,
    { create },
) {
    if (process.env.CODEX_REVIEW_DRY_RUN === "1") {
        return;
    }
    const existing = existingGateComment(pullRequest);
    if (!existing?.databaseId && !create) {
        return;
    }
    const path = existing?.databaseId
        ? `/repos/${repository}/issues/comments/${existing.databaseId}`
        : `/repos/${repository}/issues/${number}/comments`;

    try {
        await githubRequest(path, {
            method: existing?.databaseId ? "PATCH" : "POST",
            body: JSON.stringify({ body }),
        });
    } catch (error) {
        console.warn(
            `Could not update the review-gate comment: ${error.message}`,
        );
    }
}

async function publishCommitStatus(
    repository,
    headSha,
    baseRef,
    state,
    description,
) {
    const context = statusContext(baseRef);
    if (process.env.CODEX_REVIEW_DRY_RUN === "1") {
        console.log(`[dry run] ${context}: ${state} - ${description}`);
        return;
    }
    const combinedStatus = await githubRequest(
        `/repos/${repository}/commits/${headSha}/status`,
    );
    const current = combinedStatus.statuses?.find(
        (status) => status.context === context,
    );
    if (current?.state === state && current.description === description) {
        console.log(`${context} is already ${state}; no update needed.`);
        return;
    }
    const runUrl = process.env.GITHUB_RUN_ID
        ? `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : `https://github.com/${repository}/commit/${headSha}`;
    await githubRequest(`/repos/${repository}/statuses/${headSha}`, {
        method: "POST",
        body: JSON.stringify({
            context,
            description,
            state,
            target_url: runUrl,
        }),
    });
}

async function ensureReviewRequest(
    repository,
    number,
    pullRequest,
    headSha,
    baseRef,
    retryMs,
) {
    const marker = reviewRequestMarker(headSha, baseRef);
    if (
        hasActiveCodexReview(pullRequest, headSha, baseRef, Date.now(), retryMs)
    ) {
        return;
    }
    if (
        !shouldRequestReview(pullRequest, headSha, baseRef, Date.now(), retryMs)
    ) {
        return;
    }
    if (process.env.CODEX_REVIEW_DRY_RUN === "1") {
        console.log(`[dry run] Would request Codex review for ${headSha}.`);
        return;
    }
    await githubRequest(`/repos/${repository}/issues/${number}/comments`, {
        method: "POST",
        body: JSON.stringify({
            body: `@codex review\n\n${marker}\nReview commit \`${headSha}\` against \`${baseRef}\`. If there are no actionable findings, react with a thumbs-up on this request or post an LGTM comment with \`Reviewed commit: ${headSha}\` and \`Target branch: ${baseRef}\`.`,
        }),
    });
}

async function acknowledgeReviewRequests(
    repository,
    pullRequest,
    headSha,
    baseRef,
) {
    let changed = false;
    const marker = reviewAcknowledgementMarker(headSha, baseRef);

    for (const request of trustedReviewRequests(
        pullRequest,
        headSha,
        baseRef,
    )) {
        if (
            !request.databaseId ||
            isAcknowledgedRequest(request, headSha, baseRef) ||
            !hasCodexEyes(request.reactions)
        ) {
            continue;
        }
        changed = true;
        if (process.env.CODEX_REVIEW_DRY_RUN === "1") {
            console.log(
                `[dry run] Would acknowledge Codex review request ${request.databaseId}.`,
            );
            continue;
        }
        await githubRequest(
            `/repos/${repository}/issues/comments/${request.databaseId}`,
            {
                method: "PATCH",
                body: JSON.stringify({ body: `${request.body}\n\n${marker}` }),
            },
        );
    }

    return changed;
}

async function publishLgtm(
    repository,
    number,
    pullRequest,
    headSha,
    baseRef,
    activeWindowMs,
) {
    if (
        evaluateReviewState(
            pullRequest,
            headSha,
            baseRef,
            Date.now(),
            activeWindowMs,
        ).source === "codex-comment"
    ) {
        await publishGateComment(
            repository,
            number,
            pullRequest,
            `${COMMENT_MARKER}\nCodex review complete for \`${headSha.slice(0, 7)}\`; see Codex's LGTM comment.`,
            { create: false },
        );
        return;
    }
    await publishGateComment(
        repository,
        number,
        pullRequest,
        gateCommentBody(repository, headSha, baseRef),
        { create: true },
    );
}

async function openPullRequestSummaries(repository, number) {
    if (number) {
        const pullRequest = await githubRequest(
            `/repos/${repository}/pulls/${number}`,
        );
        return pullRequest.state === "open" ? [pullRequest] : [];
    }
    return githubRequest(`/repos/${repository}/pulls?state=open&per_page=100`);
}

async function listReviewablePullRequestNumbers(repository) {
    const summaries = await openPullRequestSummaries(repository);
    return summaries
        .filter(
            (summary) =>
                !summary.draft && TARGET_BRANCHES.has(summary.base?.ref),
        )
        .map((summary) => summary.number);
}

async function recoverOpenPullRequests(
    repository,
    owner,
    name,
    retryMs,
    number,
) {
    const summaries = await openPullRequestSummaries(repository, number);
    const failures = [];

    for (const summary of summaries) {
        if (summary.draft || !TARGET_BRANCHES.has(summary.base?.ref)) {
            continue;
        }
        try {
            let pullRequest = await fetchPullRequest(
                owner,
                name,
                summary.number,
            );
            const headSha = pullRequest.headRefOid;
            const baseRef = pullRequest.baseRefName;
            if (
                await acknowledgeReviewRequests(
                    repository,
                    pullRequest,
                    headSha,
                    baseRef,
                )
            ) {
                pullRequest = await fetchPullRequest(
                    owner,
                    name,
                    summary.number,
                );
            }
            const state = evaluateReviewState(
                pullRequest,
                headSha,
                baseRef,
                Date.now(),
                retryMs,
            );
            if (state.kind === "clean") {
                await publishLgtm(
                    repository,
                    summary.number,
                    pullRequest,
                    headSha,
                    baseRef,
                    retryMs,
                );
                await publishCommitStatus(
                    repository,
                    headSha,
                    baseRef,
                    "success",
                    "Codex reviewed this commit and found no actionable issues.",
                );
            } else if (state.kind === "findings") {
                await publishCommitStatus(
                    repository,
                    headSha,
                    baseRef,
                    "failure",
                    `Codex found ${state.findingCount} actionable issue${state.findingCount === 1 ? "" : "s"}.`,
                );
            } else {
                await publishCommitStatus(
                    repository,
                    headSha,
                    baseRef,
                    "pending",
                    "Waiting for Codex to review the current head commit.",
                );
                await ensureReviewRequest(
                    repository,
                    summary.number,
                    pullRequest,
                    headSha,
                    baseRef,
                    retryMs,
                );
            }
        } catch (error) {
            failures.push(`#${summary.number}: ${error.message}`);
        }
    }

    if (failures.length > 0) {
        throw new Error(`Codex review recovery failed: ${failures.join("; ")}`);
    }
}

export async function main() {
    const repository = requiredEnv("REPOSITORY");
    const [owner, name] = repository.split("/");
    if (!owner || !name) {
        throw new Error("REPOSITORY must use the owner/name format.");
    }
    if (process.env.CODEX_REVIEW_LIST === "1") {
        console.log(
            JSON.stringify(await listReviewablePullRequestNumbers(repository)),
        );
        return;
    }
    const retryMs = positiveIntegerEnv(
        "CODEX_REVIEW_RETRY_MS",
        DEFAULT_RETRY_MS,
    );
    if (process.env.CODEX_REVIEW_RECOVERY === "1") {
        const recoveryNumber = process.env.PR_NUMBER
            ? Number(process.env.PR_NUMBER)
            : undefined;
        if (
            recoveryNumber !== undefined &&
            (!Number.isSafeInteger(recoveryNumber) || recoveryNumber <= 0)
        ) {
            throw new Error("PR_NUMBER must be a positive integer.");
        }
        await recoverOpenPullRequests(
            repository,
            owner,
            name,
            retryMs,
            recoveryNumber,
        );
        return;
    }
    const number = Number(requiredEnv("PR_NUMBER"));
    const headSha = requiredEnv("PR_HEAD_SHA");
    const baseRef = requiredEnv("PR_BASE_REF");
    if (!TARGET_BRANCHES.has(baseRef)) {
        throw new Error(`Unsupported target branch ${baseRef}.`);
    }
    const intervalMs = positiveIntegerEnv(
        "CODEX_REVIEW_INTERVAL_MS",
        DEFAULT_INTERVAL_MS,
    );
    const timeoutMs = positiveIntegerEnv(
        "CODEX_REVIEW_TIMEOUT_MS",
        DEFAULT_TIMEOUT_MS,
    );
    const deadline = Date.now() + timeoutMs;
    let markedPending = false;
    let publishedStatus = "pending";

    await publishCommitStatus(
        repository,
        headSha,
        baseRef,
        "pending",
        "Waiting for Codex to review the current head commit.",
    );

    const initialPullRequest = await fetchPullRequest(owner, name, number);
    if (
        initialPullRequest.headRefOid !== headSha ||
        initialPullRequest.baseRefName !== baseRef ||
        initialPullRequest.isDraft
    ) {
        console.log(
            "The pull request review scope changed; a newer run will handle it.",
        );
        return;
    }
    try {
        while (Date.now() < deadline) {
            let pullRequest = await fetchPullRequest(owner, name, number);
            if (
                pullRequest.headRefOid !== headSha ||
                pullRequest.baseRefName !== baseRef ||
                pullRequest.isDraft
            ) {
                console.log(
                    "The pull request review scope changed; a newer run will handle it.",
                );
                return;
            }
            if (
                await acknowledgeReviewRequests(
                    repository,
                    pullRequest,
                    headSha,
                    baseRef,
                )
            ) {
                pullRequest = await fetchPullRequest(owner, name, number);
            }
            const state = evaluateReviewState(
                pullRequest,
                headSha,
                baseRef,
                Date.now(),
                retryMs,
            );

            if (state.kind === "clean") {
                await publishLgtm(
                    repository,
                    number,
                    pullRequest,
                    headSha,
                    baseRef,
                    retryMs,
                );
                await publishCommitStatus(
                    repository,
                    headSha,
                    baseRef,
                    "success",
                    "Codex reviewed this commit and found no actionable issues.",
                );
                publishedStatus = "success";
                console.log(
                    `Codex review passed for ${headSha.slice(0, 7)} via ${state.source}.`,
                );
                return;
            }
            if (state.kind === "findings") {
                await publishGateComment(
                    repository,
                    number,
                    pullRequest,
                    `${COMMENT_MARKER}\nChanges requested\n\nCodex found ${state.findingCount} actionable issue${state.findingCount === 1 ? "" : "s"} on \`${headSha.slice(0, 7)}\`. Address the inline review and push a new commit.`,
                    { create: false },
                );
                await publishCommitStatus(
                    repository,
                    headSha,
                    baseRef,
                    "failure",
                    `Codex found ${state.findingCount} actionable issue${state.findingCount === 1 ? "" : "s"}.`,
                );
                publishedStatus = "failure";
                throw new Error(
                    `Codex found ${state.findingCount} actionable issue${state.findingCount === 1 ? "" : "s"} on ${headSha.slice(0, 7)}. Address the review and push a new commit.`,
                );
            }

            if (!markedPending) {
                const shortSha = headSha.slice(0, 7);
                await publishGateComment(
                    repository,
                    number,
                    pullRequest,
                    `${COMMENT_MARKER}\nCodex review pending for [\`${shortSha}\`](https://github.com/${repository}/commit/${headSha}).`,
                    { create: false },
                );
                markedPending = true;
            }

            await ensureReviewRequest(
                repository,
                number,
                pullRequest,
                headSha,
                baseRef,
                retryMs,
            );

            console.log(`${state.reason} Checking again in ${intervalMs}ms.`);
            await sleep(intervalMs);
        }

        throw new Error(
            `Timed out waiting for Codex to review ${headSha.slice(0, 7)}. Scheduled recovery will retry the review automatically.`,
        );
    } catch (error) {
        if (publishedStatus === "pending") {
            await publishCommitStatus(
                repository,
                headSha,
                baseRef,
                "failure",
                "Codex review did not complete successfully.",
            );
        }
        throw error;
    }
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
