import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
    framework: {
        name: "@storybook/react-vite",
        options: {},
    },
    stories: ["../output/react/src/**/*.stories.@(ts|tsx)"],
};

export default config;
