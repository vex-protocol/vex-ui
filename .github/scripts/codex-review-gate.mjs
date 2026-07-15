import { pathToFileURL } from "node:url";

const CODEX_LOGIN = "chatgpt-codex-connector";
const COMMENT_MARKER = "<!-- codex-review-gate -->";
const DEFAULT_INTERVAL_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 20 * 60_000;
const STATUS_CONTEXT = "Codex Review";

const REVIEW_QUERY = `
query CodexReviewGate($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      headRefOid
      commits(last: 1) {
        nodes {
          commit {
            committedDate
          }
        }
      }
      reactions(first: 100) {
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

function isThumbsUp(content) {
    return content === "THUMBS_UP" || content === "+1";
}

function timestamp(value) {
    const parsed = Date.parse(value ?? "");
    return Number.isFinite(parsed) ? parsed : 0;
}

function isLgtm(body) {
    return /^\s*LGTM\b/i.test(body ?? "");
}

export function evaluateReviewState(pullRequest, expectedHeadSha) {
    if (!pullRequest || pullRequest.headRefOid !== expectedHeadSha) {
        return { kind: "pending", reason: "The pull request head changed." };
    }

    const committedAt = timestamp(
        pullRequest.commits?.nodes?.at(-1)?.commit?.committedDate,
    );
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
            at: timestamp(review.submittedAt),
            findingCount,
            kind: findingCount > 0 ? "findings" : "clean",
            source: "review",
        });
    }

    for (const reaction of pullRequest.reactions?.nodes ?? []) {
        if (
            isCodex(reaction.user?.login) &&
            isThumbsUp(reaction.content) &&
            timestamp(reaction.createdAt) >= committedAt
        ) {
            signals.push({
                at: timestamp(reaction.createdAt),
                findingCount: 0,
                kind: "clean",
                source: "pull-request-reaction",
            });
        }
    }

    for (const comment of pullRequest.comments?.nodes ?? []) {
        if (
            isCodex(comment.author?.login) &&
            isLgtm(comment.body) &&
            timestamp(comment.createdAt) >= committedAt
        ) {
            signals.push({
                at: timestamp(comment.createdAt),
                findingCount: 0,
                kind: "clean",
                source: "codex-comment",
            });
        }

        if (!/@codex\s+review\b/i.test(comment.body ?? "")) {
            continue;
        }
        for (const reaction of comment.reactions?.nodes ?? []) {
            if (
                isCodex(reaction.user?.login) &&
                isThumbsUp(reaction.content) &&
                timestamp(reaction.createdAt) >= committedAt
            ) {
                signals.push({
                    at: timestamp(reaction.createdAt),
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

function gateCommentBody(repository, headSha) {
    const shortSha = headSha.slice(0, 7);
    return `${COMMENT_MARKER}\nLGTM\n\nCodex reviewed [\`${shortSha}\`](https://github.com/${repository}/commit/${headSha}) and reported no actionable findings.`;
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

export async function main() {
    const repository = requiredEnv("REPOSITORY");
    const [owner, name] = repository.split("/");
    if (!owner || !name) {
        throw new Error("REPOSITORY must use the owner/name format.");
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
