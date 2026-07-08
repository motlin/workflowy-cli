import {defineConfig} from 'vite-plus';

export default defineConfig({
	staged: {
		'*': 'vp check --fix',
	},
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
	},
	lint: {
		ignorePatterns: ['packages/web/src/client/app.tsx', 'packages/web/.storybook/preview.ts'],
		options: {typeAware: true, typeCheck: true},
	},
});
