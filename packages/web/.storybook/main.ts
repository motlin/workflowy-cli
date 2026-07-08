import type {StorybookConfig} from '@storybook/react-vite';

const config: StorybookConfig = {
	stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
	addons: ['@storybook/addon-a11y', '@storybook/addon-docs'],
	framework: '@storybook/react-vite',
	async viteFinal(config) {
		// Override vite config for storybook - remove the root setting
		// since storybook manages its own root
		return {
			...config,
			root: undefined,
		};
	},
};

export default config;
