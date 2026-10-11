import {defineConfig} from 'vite-plus';

export default defineConfig({
	fmt: {
		tabWidth: 4,
		useTabs: true,
		semi: true,
		singleQuote: true,
		trailingComma: 'all',
		bracketSpacing: false,
		arrowParens: 'always',
		printWidth: 120,
		quoteProps: 'as-needed',
		jsxSingleQuote: false,
		bracketSameLine: false,
		singleAttributePerLine: true,
		proseWrap: 'never',
		htmlWhitespaceSensitivity: 'css',
		endOfLine: 'lf',
		sortPackageJson: false,
		overrides: [
			{
				files: ['.yamllint.yaml', '**/*.yaml', '**/*.yml'],
				options: {useTabs: false, tabWidth: 2, singleQuote: false},
			},
		],
	},
	run: {
		tasks: {
			check: {
				command: 'vp check',
			},
			'test:run': {
				command: 'node node_modules/vitest/dist/cli.js run',
				cache: {
					input: [{auto: true}, '!node_modules/.experimental-vitest-cache/**'],
					output: [],
				},
			},
		},
	},
	lint: {
		ignorePatterns: ['packages/web/src/client/app.tsx', 'packages/web/.storybook/preview.ts'],
		options: {typeAware: true, typeCheck: true},
	},
});
