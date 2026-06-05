<script lang="ts">
    import { onMount, tick } from "svelte";
    import { push } from "svelte-spa-router";

    import { getServerOptions } from "../lib/config.js";
    import { keyStore } from "../lib/keystore.js";
    import Loading from "../lib/Loading.svelte";
    import { desktopConfig } from "../lib/platform.js";
    import {
        channels as channelsAtom,
        servers as serversAtom,
        user,
        vexService,
    } from "../lib/store/index.js";

    let errorMsg = $state<null | string>(null);
    let loading = $state(true);

    async function runAutoLogin(): Promise<void> {
        errorMsg = null;
        loading = true;
        try {
            const result = await Promise.race([
                vexService.autoLogin(
                    keyStore,
                    desktopConfig(),
                    getServerOptions(),
                ),
                new Promise<{ error: string; ok: false }>((resolve) =>
                    setTimeout(
                        () =>
                            resolve({
                                error: "Connection timed out after 15s.",
                                ok: false,
                            }),
                        15_000,
                    ),
                ),
            ]);

            if (!result.ok) {
                // No creds → expected first-run flow, go to login silently.
                if (!result.error) {
                    await tick();
                    void push("/login");
                    return;
                }
                // Real failure → surface + let user retry.
                errorMsg = result.error;
                loading = false;
                return;
            }

            const u = user.get();
            if (!u) {
                await tick();
                void push("/login");
                return;
            }

            const serverList = Object.values(serversAtom.get());
            if (serverList.length > 0) {
                const firstServer = serverList[0];
                if (!firstServer) {
                    await tick();
                    window.location.hash = "#/home";
                    return;
                }
                const sid = firstServer.serverID;
                const chs = channelsAtom.get()[sid] ?? [];
                const firstChannel = chs[0];
                await tick();
                window.location.hash = firstChannel
                    ? `#/server/${sid}/${firstChannel.channelID}`
                    : "#/home";
            } else {
                await tick();
                window.location.hash = "#/home";
            }
        } catch (err: unknown) {
            errorMsg = err instanceof Error ? err.message : "Unknown error.";
            loading = false;
        }
    }

    onMount(() => {
        void runAutoLogin();
    });
</script>

<div class="launch">
    {#if errorMsg}
        <div class="launch__error">
            <h2>Can't connect</h2>
            <p class="launch__error-msg">{errorMsg}</p>
            <div class="launch__actions">
                <button onclick={() => void runAutoLogin()}>Retry</button>
                <button onclick={() => void push("/login")}>
                    Go to login
                </button>
            </div>
        </div>
    {:else if loading}
        <Loading label="Connecting to server..." size="lg" />
    {/if}
</div>

<style>
    .launch {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg-primary);
    }

    .launch__error {
        max-width: 400px;
        padding: 2rem;
        text-align: center;
        color: var(--text-primary);
    }

    .launch__error-msg {
        margin: 1rem 0 1.5rem;
        color: var(--text-secondary);
        word-break: break-word;
    }

    .launch__actions {
        display: flex;
        gap: 0.5rem;
        justify-content: center;
    }

    .launch__actions button {
        padding: 0.5rem 1rem;
        border: 1px solid var(--border);
        background: var(--bg-secondary);
        color: var(--text-primary);
        border-radius: 4px;
        cursor: pointer;
    }

    .launch__actions button:hover {
        background: var(--bg-tertiary);
    }
</style>
