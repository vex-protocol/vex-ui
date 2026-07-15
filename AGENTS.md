## Review guidelines

- Focus review comments on actionable correctness, security, privacy, data-loss,
  performance, and user-facing regressions. Avoid style-only feedback that is
  already enforced by CI.
- Give authentication, authorization, session lifecycle, key management, and
  encryption changes extra scrutiny.
- Review the current pull request head commit, including whether earlier Codex
  findings were actually addressed.
- If no actionable findings remain, leave a top-level comment in this format
  instead of only adding a reaction. Use the full current commit SHA.

    ```text
    LGTM

    Reviewed commit: <full commit SHA>
    ```
