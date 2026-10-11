import {defineConfig} from "vite-plus";

export default defineConfig({
	fmt: {
		semi: true,
		singleQuote: false,
		useTabs: true,
		tabWidth: 4,
		printWidth: 120,
		proseWrap: "never",
		embeddedLanguageFormatting: "off",
		bracketSpacing: false,
		trailingComma: "all",
		arrowParens: "always",
		overrides: [
			{
				files: [".yamllint.yaml", "**/*.yaml", "**/*.yml"],
				options: {
					useTabs: false,
					tabWidth: 2,
				},
			},
			{
				files: ["**/*.md"],
				options: {
					printWidth: 320,
				},
			},
		],
	},
	run: {
		tasks: {
			check: {
				command: "vp check",
			},
			"test:run": {
				command: "node node_modules/vitest/dist/cli.js run",
				cache: {
					input: [{auto: true}, "!node_modules/.experimental-vitest-cache/**"],
					output: [],
				},
			},
		},
	},
	lint: {
		plugins: ["typescript", "unicorn", "oxc", "import", "react", "vitest", "promise", "node"],
		jsPlugins: [
			{
				name: "vite-plus",
				specifier: "vite-plus/oxlint-plugin",
			},
		],
		categories: {
			correctness: "error",
			suspicious: "error",
		},
		rules: {
			"vite-plus/prefer-vite-plus-imports": "error",
			"react/react-in-jsx-scope": "off",
			"vitest/expect-expect": ["error", {assertFunctionNames: ["expect", "expect*"]}],
			"vitest/valid-expect": ["error", {maxArgs: 2}],
			// Stylesheets and the MCP bin entrypoint are imported for their side effects.
			"import/no-unassigned-import": ["error", {allow: ["**/*.css", "**/dist/index.js"]}],
			// False positives on deps used inside a nested async IIFE; dropping them creates stale closures.
			"react/memo-dependencies": "off",
			"typescript/no-unsafe-type-assertion": "error",
		},
		overrides: [
			{
				files: ["**/*.test.ts", "**/*.test.tsx", "**/*.test.mjs"],
				rules: {
					// Per-test fakes read better next to the assertion that uses them than hoisted to module scope.
					"unicorn/consistent-function-scoping": "off",
				},
			},
		],
		env: {
			builtin: true,
		},
		ignorePatterns: [
			"dist",
			"build",
			"storybook-static",
			".llm/**",
			"packages/web/src/client/app.tsx",
			"packages/web/.storybook/preview.ts",
		],
		options: {typeAware: true, typeCheck: true},
	},
});
