<script lang="ts">
    import { push } from "svelte-spa-router";

    import { ArrowLeft, Check, Moon, Palette, Sun } from "@lucide/svelte";

    import {
        accentPreference,
        accentPresets,
        setAccentPreference,
        setTheme,
        theme,
    } from "../lib/stores/theme.js";
    import "../settings-detail.css";
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
            <span>Personalization</span>
            <h1>Appearance</h1>
        </div>
    </header>

    <div class="settings-detail__scroll">
        <main class="settings-detail__body">
            <div class="settings-detail__intro">
                <span class="settings-detail__intro-icon">
                    <Palette size={20} />
                </span>
                <div>
                    <h2>Make Vex yours</h2>
                    <p>Choose the contrast and color that feel best to you.</p>
                </div>
            </div>

            <section class="settings-detail__section">
                <div class="settings-detail__section-header">
                    <h3>Theme</h3>
                </div>
                <div class="theme-segments" aria-label="Theme" role="group">
                    <button
                        class:theme-segments__option--active={$theme === "dark"}
                        class="theme-segments__option"
                        type="button"
                        aria-pressed={$theme === "dark"}
                        onclick={() => setTheme("dark")}
                    >
                        <Moon size={17} />
                        Dark
                    </button>
                    <button
                        class:theme-segments__option--active={$theme ===
                            "light"}
                        class="theme-segments__option"
                        type="button"
                        aria-pressed={$theme === "light"}
                        onclick={() => setTheme("light")}
                    >
                        <Sun size={17} />
                        Light
                    </button>
                </div>
            </section>

            <section class="settings-detail__section">
                <div class="settings-detail__section-header">
                    <h3>Primary color</h3>
                </div>
                <div class="accent-grid" role="radiogroup">
                    {#each accentPresets as preset (preset.id)}
                        <button
                            class:accent-swatch--active={$accentPreference ===
                                preset.id}
                            class="accent-swatch"
                            type="button"
                            role="radio"
                            aria-checked={$accentPreference === preset.id}
                            aria-label={`${preset.label} primary color`}
                            onclick={() => setAccentPreference(preset.id)}
                        >
                            <span
                                class="accent-swatch__color"
                                style:background={preset.color}
                            >
                                {#if $accentPreference === preset.id}
                                    <Check size={18} strokeWidth={2.5} />
                                {/if}
                            </span>
                            <span>{preset.label}</span>
                        </button>
                    {/each}
                </div>
            </section>
        </main>
    </div>
</div>

<style>
    .theme-segments {
        width: fit-content;
        display: inline-grid;
        grid-template-columns: repeat(2, minmax(112px, 1fr));
        gap: 3px;
        padding: 3px;
        border: 1px solid var(--border);
        border-radius: 7px;
        background: var(--bg-secondary);
    }

    .theme-segments__option {
        min-height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        padding: 0 14px;
        border-radius: 5px;
        color: var(--text-muted);
        font-size: 12px;
        font-weight: 700;
    }

    .theme-segments__option:hover {
        color: var(--text-primary);
        background: var(--bg-hover);
    }

    .theme-segments__option--active {
        color: var(--on-accent);
        background: var(--accent);
    }

    .theme-segments__option--active:hover {
        color: var(--on-accent);
        background: var(--accent-hover);
    }

    .accent-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(92px, 1fr));
        gap: 8px;
    }

    .accent-swatch {
        min-height: 76px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 7px;
        padding: 9px;
        border: 1px solid var(--border);
        border-radius: 7px;
        background: var(--bg-secondary);
        color: var(--text-muted);
        font-size: 11px;
        font-weight: 700;
    }

    .accent-swatch:hover {
        border-color: var(--border-strong);
        background: var(--bg-hover);
        color: var(--text-primary);
    }

    .accent-swatch--active {
        border-color: var(--accent-border);
        background: var(--accent-soft);
        color: var(--accent-text);
    }

    .accent-swatch__color {
        width: 34px;
        height: 34px;
        display: grid;
        place-items: center;
        border: 1px solid color-mix(in srgb, white 28%, transparent);
        border-radius: 50%;
        color: white;
    }

    @media (max-width: 760px) {
        .accent-grid {
            grid-template-columns: repeat(2, minmax(92px, 1fr));
        }
    }
</style>
