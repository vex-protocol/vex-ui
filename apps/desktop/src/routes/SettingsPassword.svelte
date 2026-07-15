<script lang="ts">
    import { push } from "svelte-spa-router";

    import { ArrowLeft, LockKeyhole } from "@lucide/svelte";

    import { vexService } from "../lib/store/index.js";
    import "../settings-detail.css";

    let currentPassword = $state("");
    let newPassword = $state("");
    let confirmPassword = $state("");
    let busy = $state(false);
    let error = $state("");
    let notice = $state("");
    let showPasswords = $state(false);

    async function changePassword(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        error = "";
        notice = "";
        if (!currentPassword) {
            error = "Enter your current password.";
            return;
        }
        if (newPassword.length < 15) {
            error = "Use at least 15 characters for the new password.";
            return;
        }
        if (newPassword.length > 1024) {
            error = "The new password is too long.";
            return;
        }
        if (newPassword !== confirmPassword) {
            error = "New passwords do not match.";
            return;
        }

        busy = true;
        try {
            const result = await vexService.changePassword(
                currentPassword,
                newPassword,
            );
            if (!result.ok) {
                error = result.error ?? "Could not change password.";
                return;
            }
            currentPassword = "";
            newPassword = "";
            confirmPassword = "";
            notice = "Password updated.";
        } catch (err: unknown) {
            error =
                err instanceof Error
                    ? err.message
                    : "Could not change password.";
        } finally {
            busy = false;
        }
    }
</script>

<div class="settings-detail">
    <header class="settings-detail__header">
        <button
            class="settings-detail__back"
            type="button"
            aria-label="Back to settings"
            onclick={() => void push("/settings?tab=account")}
        >
            <ArrowLeft size={19} />
        </button>
        <div class="settings-detail__heading">
            <span>Account security</span>
            <h1>Password</h1>
        </div>
    </header>

    <div class="settings-detail__scroll">
        <main class="settings-detail__body">
            <div class="settings-detail__intro">
                <span class="settings-detail__intro-icon">
                    <LockKeyhole size={20} />
                </span>
                <div>
                    <h2>Change password</h2>
                    <p>
                        Updating your password revokes existing login sessions.
                        Approved devices keep their local encrypted history.
                    </p>
                </div>
            </div>

            <section class="settings-detail__section">
                <form class="settings-detail__form" onsubmit={changePassword}>
                    <div class="settings-detail__fields">
                        <div class="settings-detail__field">
                            <label for="current-password"
                                >Current password</label
                            >
                            <input
                                id="current-password"
                                autocomplete="current-password"
                                type={showPasswords ? "text" : "password"}
                                bind:value={currentPassword}
                                disabled={busy}
                                required
                            />
                        </div>
                        <div class="settings-detail__field">
                            <label for="new-password">New password</label>
                            <input
                                id="new-password"
                                autocomplete="new-password"
                                type={showPasswords ? "text" : "password"}
                                bind:value={newPassword}
                                disabled={busy}
                                minlength={15}
                                maxlength={1024}
                                required
                            />
                            <span class="settings-detail__hint"
                                >Use at least 15 characters.</span
                            >
                        </div>
                        <div class="settings-detail__field">
                            <label for="confirm-password"
                                >Confirm password</label
                            >
                            <input
                                id="confirm-password"
                                autocomplete="new-password"
                                type={showPasswords ? "text" : "password"}
                                bind:value={confirmPassword}
                                disabled={busy}
                                minlength={15}
                                maxlength={1024}
                                required
                            />
                        </div>
                    </div>

                    <label class="settings-detail__check">
                        <input type="checkbox" bind:checked={showPasswords} />
                        Show passwords
                    </label>

                    {#if error}
                        <p
                            class="settings-detail__status settings-detail__status--error"
                            role="alert"
                        >
                            {error}
                        </p>
                    {:else if notice}
                        <p
                            class="settings-detail__status settings-detail__status--success"
                            role="status"
                        >
                            {notice}
                        </p>
                    {/if}

                    <div class="settings-detail__actions">
                        <button
                            class="settings-detail__button settings-detail__button--primary"
                            type="submit"
                            disabled={busy}
                        >
                            {busy ? "Updating..." : "Update password"}
                        </button>
                    </div>
                </form>
            </section>
        </main>
    </div>
</div>
