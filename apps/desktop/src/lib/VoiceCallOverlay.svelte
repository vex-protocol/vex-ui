<script lang="ts">
    import type { CallEvent } from "@vex-chat/libvex";

    import {
        familiars,
        incomingCalls,
        latestCallEvent,
    } from "./store/index.js";
    import {
        voiceCallEngine,
        type VoiceCallMediaState,
        type VoiceCallPhase,
        $voiceCallState as voiceCallState,
    } from "./voiceCallEngine.js";

    let busyCallID = $state<null | string>(null);
    let error = $state<null | string>(null);
    let handledEvent: CallEvent | null = null;

    const incomingEvent = $derived(Object.values($incomingCalls)[0] ?? null);
    const callVisible = $derived($voiceCallState.phase !== "idle");
    const displayedError = $derived(error ?? $voiceCallState.mediaError);
    const incomingVisible = $derived(
        incomingEvent !== null &&
            ($voiceCallState.phase === "idle" || !callVisible),
    );
    const incomingName = $derived(
        incomingEvent
            ? ($familiars[incomingEvent.fromUserID]?.username ?? "Vex user")
            : null,
    );
    const activePeerName = $derived(
        $voiceCallState.peerUsername ??
            ($voiceCallState.peerUserID
                ? ($familiars[$voiceCallState.peerUserID]?.username ??
                  "Vex user")
                : "Vex call"),
    );

    $effect(() => {
        const event = $latestCallEvent;
        if (!event || handledEvent === event) {
            return;
        }
        handledEvent = event;
        void voiceCallEngine.handleCallEvent(event).catch((err: unknown) => {
            console.warn(
                "[vex-call] failed to handle signaling event",
                err instanceof Error ? err.message : String(err),
            );
        });
    });

    function acceptIncoming(event: CallEvent): void {
        busyCallID = event.call.callID;
        error = null;
        void voiceCallEngine
            .acceptIncomingCall(
                event,
                $familiars[event.fromUserID]?.username ?? undefined,
            )
            .catch((err: unknown) => {
                error = errorMessage(err);
            })
            .finally(() => {
                busyCallID = null;
            });
    }

    function hangup(): void {
        error = null;
        void voiceCallEngine.hangup().catch((err: unknown) => {
            error = errorMessage(err);
        });
    }

    function rejectIncoming(event: CallEvent): void {
        busyCallID = event.call.callID;
        error = null;
        void voiceCallEngine
            .rejectIncomingCall(event)
            .catch((err: unknown) => {
                error = errorMessage(err);
            })
            .finally(() => {
                busyCallID = null;
            });
    }

    function errorMessage(err: unknown): string {
        return err instanceof Error ? err.message : String(err);
    }

    function phaseLabel(
        phase: VoiceCallPhase,
        mediaState: VoiceCallMediaState,
    ): string {
        switch (phase) {
            case "active":
                return mediaPhaseLabel(mediaState);
            case "connecting":
                return "Connecting";
            case "error":
                return "Call failed";
            case "idle":
                return "";
            case "ringing":
                return "Ringing";
        }
    }

    function mediaPhaseLabel(mediaState: VoiceCallMediaState): string {
        switch (mediaState) {
            case "connected":
                return "Connected";
            case "connecting":
            case "idle":
                return "Connecting media";
            case "disconnected":
                return "Reconnecting media";
            case "failed":
                return "Media failed";
            case "signaling-only":
                return "Signaling connected";
        }
    }
</script>

{#if incomingVisible || callVisible || displayedError}
    <div class="voice-overlay">
        {#if incomingVisible && incomingEvent}
            <section class="voice-panel voice-panel--incoming">
                <div class="voice-panel__copy">
                    <div class="voice-panel__title">{incomingName}</div>
                    <div class="voice-panel__subtitle">Incoming voice call</div>
                </div>
                <div class="voice-panel__actions">
                    <button
                        class="voice-button voice-button--danger"
                        type="button"
                        disabled={busyCallID === incomingEvent.call.callID}
                        aria-label="Reject voice call"
                        title="Reject voice call"
                        onclick={() => rejectIncoming(incomingEvent)}
                    >
                        Decline
                    </button>
                    <button
                        class="voice-button voice-button--accept"
                        type="button"
                        disabled={busyCallID === incomingEvent.call.callID}
                        aria-label="Accept voice call"
                        title="Accept voice call"
                        onclick={() => acceptIncoming(incomingEvent)}
                    >
                        Accept
                    </button>
                </div>
            </section>
        {/if}

        {#if callVisible}
            <section class="voice-panel">
                <div class="voice-panel__copy">
                    <div class="voice-panel__title">{activePeerName}</div>
                    <div class="voice-panel__subtitle">
                        {phaseLabel(
                            $voiceCallState.phase,
                            $voiceCallState.mediaState,
                        )}
                    </div>
                </div>
                <div class="voice-panel__actions">
                    <button
                        class="voice-button"
                        type="button"
                        aria-label={$voiceCallState.muted
                            ? "Unmute microphone"
                            : "Mute microphone"}
                        title={$voiceCallState.muted
                            ? "Unmute microphone"
                            : "Mute microphone"}
                        onclick={() => {
                            voiceCallEngine.toggleMute();
                        }}
                    >
                        {$voiceCallState.muted ? "Unmute" : "Mute"}
                    </button>
                    <button
                        class="voice-button voice-button--danger"
                        type="button"
                        aria-label="End voice call"
                        title="End voice call"
                        onclick={hangup}
                    >
                        End
                    </button>
                </div>
            </section>
        {/if}

        {#if displayedError}
            <div class="voice-error">{displayedError}</div>
        {/if}
    </div>
{/if}

<style>
    .voice-overlay {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 50;
        display: flex;
        width: min(360px, calc(100vw - 36px));
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
    }

    .voice-panel,
    .voice-error {
        pointer-events: auto;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--bg-secondary);
        box-shadow: 0 12px 32px rgb(0 0 0 / 0.35);
    }

    .voice-panel {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        min-height: 72px;
        padding: 14px;
    }

    .voice-panel--incoming {
        border-color: color-mix(in srgb, var(--success) 45%, var(--border));
    }

    .voice-panel__copy {
        min-width: 0;
    }

    .voice-panel__title {
        overflow: hidden;
        color: var(--text-primary);
        font-size: 14px;
        font-weight: 700;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .voice-panel__subtitle {
        margin-top: 3px;
        color: var(--text-secondary);
        font-size: 12px;
    }

    .voice-panel__actions {
        display: flex;
        flex-shrink: 0;
        gap: 8px;
    }

    .voice-button {
        min-width: 58px;
        height: 34px;
        padding: 0 12px;
        border: 1px solid var(--border);
        border-radius: 4px;
        background: var(--bg-surface);
        color: var(--text-primary);
        font-size: 12px;
        font-weight: 700;
    }

    .voice-button:hover:not(:disabled) {
        background: var(--bg-hover);
    }

    .voice-button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
    }

    .voice-button--accept {
        border-color: color-mix(in srgb, var(--success) 55%, var(--border));
        background: var(--success);
        color: #fff;
    }

    .voice-button--danger {
        border-color: color-mix(in srgb, var(--danger) 55%, var(--border));
        background: var(--danger);
        color: #fff;
    }

    .voice-error {
        padding: 10px 12px;
        color: var(--danger);
        font-size: 12px;
        line-height: 1.35;
    }
</style>
