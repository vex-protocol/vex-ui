import type { StorybookConfig } from "@storybook/svelte-vite";

import { svelte } from "@sveltejs/vite-plugin-svelte";

const config: StorybookConfig = {
    framework: {
        name: "@storybook/svelte-vite",
        options: {},
    },
    stories: ["../output/svelte/src/**/*.stories.@(ts|svelte)"],
    viteFinal: (config) => ({
        ...config,
        plugins: [svelte(), ...(config.plugins ?? [])],
    }),
};

export default config;
