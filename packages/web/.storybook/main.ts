import type {StorybookConfig} from "@storybook/react-vite";

process.title = "workflowy-storybook";

const config: StorybookConfig = {
	stories: ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
	addons: ["@storybook/addon-a11y", "@storybook/addon-docs"],
	framework: "@storybook/react-vite",
	async viteFinal(viteConfig) {
		// Override vite config for storybook - remove the root setting
		// since storybook manages its own root
		return {
			...viteConfig,
			root: undefined,
		};
	},
};

export default config;
