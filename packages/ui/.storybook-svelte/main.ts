import type { StorybookConfig } from "@storybook/svelte-vite";

const config: StorybookConfig = {
    stories: ["../output/svelte/src/**/*.stories.@(ts|svelte)"],
    framework: {
        name: "@storybook/svelte-vite",
        options: {},
    },
    addons: ["@storybook/addon-essentials"],
};

export default config;
