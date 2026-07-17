<script lang="ts">
    import { push } from "svelte-spa-router";

    import { ArrowLeft, Network } from "@lucide/svelte";

    import { getServerUrl, setServerUrl } from "../lib/config.js";
    import "../settings-detail.css";

    let serverUrl = $state(getServerUrl());

    function saveAndReconnect(event: SubmitEvent): void {
        event.preventDefault();
        const next = serverUrl.trim();
        if (!next) return;
        setServerUrl(next);
        window.location.href = "/";
    }
</script>

<div class="settings-detail">
    <header class="settings-detail__header">
        <button
            class="settings-detail__back"
            type="button"
            aria-label="Back to settings"
            onclick={() => void push("/settings?tab=general")}
        >
            <ArrowLeft size={19} />
        </button>
        <div class="settings-detail__heading">
            <span>Network</span>
            <h1>Connection</h1>
        </div>
    </header>

    <div class="settings-detail__scroll">
        <main class="settings-detail__body">
            <div class="settings-detail__intro">
                <span class="settings-detail__intro-icon">
                    <Network size={20} />
                </span>
                <div>
                    <h2>Homeserver</h2>
                    <p>Choose the Vex server used by this installation.</p>
                </div>
            </div>

            <section class="settings-detail__section">
                <form class="settings-detail__form" onsubmit={saveAndReconnect}>
                    <div class="settings-detail__field">
                        <label for="server-url">Server URL</label>
                        <input
                            id="server-url"
                            type="text"
                            inputmode="url"
                            autocomplete="url"
                            autocapitalize="none"
                            spellcheck="false"
                            bind:value={serverUrl}
                            placeholder="api.vex.wtf"
                            required
                        />
                    </div>
                    <div class="settings-detail__actions">
                        <button
                            class="settings-detail__button settings-detail__button--primary"
                            type="submit"
                            disabled={!serverUrl.trim()}
                        >
                            Save and reconnect
                        </button>
                    </div>
                </form>
            </section>
        </main>
    </div>
</div>
