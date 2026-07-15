import { pathToFileURL } from "node:url";

const CODEX_LOGIN = "chatgpt-codex-connector";
const COMMENT_MARKER = "<!-- codex-review-gate -->";
const DEFAULT_INTERVAL_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const REVIEW_REQUEST_MARKER = "codex-review-request";
const STATUS_CONTEXT = "Codex Review";
const TARGET_BRANCHES = new Set(["development", "master"]);

const REVIEW_QUERY = `
query CodexReviewGate($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      headRefOid
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

function reviewRequestMarker(headSha) {
    return `<!-- ${REVIEW_REQUEST_MARKER}:${headSha} -->`;
}

function isLgtmForHead(body, headSha) {
    const normalizedBody = String(body ?? "").toLowerCase();
    return (
        /^\s*LGTM\b/i.test(normalizedBody) &&
        (normalizedBody.includes(headSha.toLowerCase()) ||
            normalizedBody.includes(headSha.slice(0, 10).toLowerCase()))
    );
}

export function evaluateReviewState(pullRequest, expectedHeadSha) {
    if (!pullRequest || pullRequest.headRefOid !== expectedHeadSha) {
        return { kind: "pending", reason: "The pull request head changed." };
    }

    const signals = [];

    for (const review of pullRequest.reviews?.nodes ?? []) {
        if (
            !isCodex(review.author?.login) ||
            review.commit?.oid !== expectedHeadSha
        ) {
            continue;
        }
        const findingCount = review.comments?.totalCount ?? 0;
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
            isLgtmForHead(comment.body, expectedHeadSha)
        ) {
            signals.push({
                at: Date.parse(comment.createdAt ?? "") || 0,
                findingCount: 0,
                kind: "clean",
                source: "codex-comment",
            });
        }

        if (
            !isGitHubActions(comment.author?.login) ||
            !comment.body?.includes(reviewRequestMarker(expectedHeadSha))
        ) {
            continue;
        }
        const requestCreatedAt = Date.parse(comment.createdAt ?? "");
        if (!Number.isFinite(requestCreatedAt)) {
            continue;
        }
        for (const reaction of comment.reactions?.nodes ?? []) {
            const reactionCreatedAt = Date.parse(reaction.createdAt ?? "");
            if (
                isCodex(reaction.user?.login) &&
                isThumbsUp(reaction.content) &&
                Number.isFinite(reactionCreatedAt) &&
                reactionCreatedAt >= requestCreatedAt
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

    signals.sort((left, right) => left.at - right.at);
    return (
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

export function gateCommentBody(repository, headSha) {
    const shortSha = headSha.slice(0, 7);
    return `LGTM\n\n${COMMENT_MARKER}\nCodex reviewed [\`${shortSha}\`](https://github.com/${repository}/commit/${headSha}) and reported no actionable findings.`;
}

function existingGateComment(pullRequest) {
    return (pullRequest.comments?.nodes ?? []).find((comment) =>
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

async function publishCommitStatus(repository, headSha, state, description) {
    if (process.env.CODEX_REVIEW_DRY_RUN === "1") {
        console.log(`[dry run] ${STATUS_CONTEXT}: ${state} - ${description}`);
        return;
    }
    const combinedStatus = await githubRequest(
        `/repos/${repository}/commits/${headSha}/status`,
    );
    const current = combinedStatus.statuses?.find(
        (status) => status.context === STATUS_CONTEXT,
    );
    if (current?.state === state && current.description === description) {
        console.log(`${STATUS_CONTEXT} is already ${state}; no update needed.`);
        return;
    }
    const runUrl = process.env.GITHUB_RUN_ID
        ? `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : `https://github.com/${repository}/commit/${headSha}`;
    await githubRequest(`/repos/${repository}/statuses/${headSha}`, {
        method: "POST",
        body: JSON.stringify({
            context: STATUS_CONTEXT,
            description,
            state,
            target_url: runUrl,
        }),
    });
}

async function ensureReviewRequest(repository, number, pullRequest, headSha) {
    const marker = reviewRequestMarker(headSha);
    if (
        (pullRequest.comments?.nodes ?? []).some((comment) =>
            comment.body?.includes(marker),
        )
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
            body: `@codex review\n\n${marker}\nReview the current head commit \`${headSha}\`. If there are no actionable findings, react with a thumbs-up on this request or post an LGTM comment that names this commit.`,
        }),
    });
}

async function publishLgtm(repository, number, pullRequest, headSha) {
    if (evaluateReviewState(pullRequest, headSha).source === "codex-comment") {
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
        gateCommentBody(repository, headSha),
        { create: true },
    );
}

async function recoverOpenPullRequests(repository, owner, name) {
    const summaries = await githubRequest(
        `/repos/${repository}/pulls?state=open&per_page=100`,
    );
    const failures = [];

    for (const summary of summaries) {
        if (summary.draft || !TARGET_BRANCHES.has(summary.base?.ref)) {
            continue;
        }
        try {
            const pullRequest = await fetchPullRequest(
                owner,
                name,
                summary.number,
            );
            const headSha = pullRequest.headRefOid;
            const state = evaluateReviewState(pullRequest, headSha);
            if (state.kind === "clean") {
                await publishLgtm(
                    repository,
                    summary.number,
                    pullRequest,
                    headSha,
                );
                await publishCommitStatus(
                    repository,
                    headSha,
                    "success",
                    "Codex reviewed this commit and found no actionable issues.",
                );
            } else if (state.kind === "findings") {
                await publishCommitStatus(
                    repository,
                    headSha,
                    "failure",
                    `Codex found ${state.findingCount} actionable issue${state.findingCount === 1 ? "" : "s"}.`,
                );
            } else {
                await publishCommitStatus(
                    repository,
                    headSha,
                    "pending",
                    "Waiting for Codex to review the current head commit.",
                );
                await ensureReviewRequest(
                    repository,
                    summary.number,
                    pullRequest,
                    headSha,
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
    if (process.env.CODEX_REVIEW_RECOVERY === "1") {
        await recoverOpenPullRequests(repository, owner, name);
        return;
    }
    const number = Number(requiredEnv("PR_NUMBER"));
    const headSha = requiredEnv("PR_HEAD_SHA");
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
        "pending",
        "Waiting for Codex to review the current head commit.",
    );

    const initialPullRequest = await fetchPullRequest(owner, name, number);
    if (initialPullRequest.headRefOid !== headSha) {
        console.log(
            "The pull request head changed; a newer run will review it.",
        );
        return;
    }
    if (evaluateReviewState(initialPullRequest, headSha).kind === "pending") {
        await ensureReviewRequest(
            repository,
            number,
            initialPullRequest,
            headSha,
        );
    }

    try {
        while (Date.now() < deadline) {
            const pullRequest = await fetchPullRequest(owner, name, number);
            const state = evaluateReviewState(pullRequest, headSha);

            if (state.kind === "clean") {
                await publishLgtm(repository, number, pullRequest, headSha);
                await publishCommitStatus(
                    repository,
                    headSha,
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

            console.log(`${state.reason} Checking again in ${intervalMs}ms.`);
            await sleep(intervalMs);
        }

        throw new Error(
            `Timed out waiting for Codex to review ${headSha.slice(0, 7)}. Request a new review with "@codex review", then re-run this check.`,
        );
    } catch (error) {
        if (publishedStatus === "pending") {
            await publishCommitStatus(
                repository,
                headSha,
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
