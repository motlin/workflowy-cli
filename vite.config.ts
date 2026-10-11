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
		plugins: ["typescript", "unicorn", "oxc", "import", "react", "vitest", "promise", "node", "jsx-a11y"],
		jsPlugins: [
			{
				name: "vite-plus",
				specifier: "vite-plus/oxlint-plugin",
			},
		],
		categories: {
			correctness: "error",
			suspicious: "error",
			perf: "error",
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
			"typescript/switch-exhaustiveness-check": "error",
			"typescript/return-await": "error",
			"typescript/only-throw-error": "error",
			"typescript/prefer-promise-reject-errors": "error",
			"typescript/no-mixed-enums": "error",
			"typescript/related-getter-setter-pairs": "error",
			// `||` on a primitive also defaults "" and 0, which most of these call sites rely on.
			"typescript/prefer-nullish-coalescing": ["error", {ignorePrimitives: true}],
			"typescript/prefer-includes": "error",
			"typescript/no-unnecessary-type-assertion": "error",
			"unicorn/prefer-string-replace-all": "error",
			// React 19's useRef<T>(initial) requires its argument, so `useRef<T>(undefined)` must stay.
			"unicorn/no-useless-undefined": ["error", {checkArguments: false}],
			eqeqeq: ["error", "smart"],
			// `{...row, key}` inside map is how this codebase updates data without aliasing the caller's objects.
			"oxc/no-map-spread": "off",
			// ~77 hits are deliberately sequential: rate-limited Workflowy writes, ordered moves, retries, and path walks.
			"no-await-in-loop": "off",
			curly: "error",
			"prefer-template": "error",
			"no-implicit-coercion": "error",
			"typescript/array-type": "error",
			"typescript/consistent-type-imports": "error",
			"import/consistent-type-specifier-style": "error",
			"unicorn/numeric-separators-style": "error",
			// Explicit imports from vite-plus/test satisfy this rule and prefer-vite-plus-imports together.
			"vitest/prefer-importing-vitest-globals": "error",
			"vitest/prefer-strict-equal": "error",
			"vitest/prefer-to-be": "error",
			"vitest/prefer-to-have-length": "error",
			"vitest/prefer-each": "error",
			"vitest/prefer-called-once": "error",
			"vitest/prefer-expect-resolves": "error",
			"vitest/prefer-hooks-in-order": "error",
			"vitest/prefer-expect-type-of": "error",
			"typescript/require-await": "error",
			"typescript/no-misused-promises": "error",
			"typescript/strict-void-return": "error",
			"typescript/no-confusing-void-expression": ["error", {ignoreArrowShorthand: true}],
			"typescript/promise-function-async": "error",
			"typescript/no-deprecated": "error",
			"typescript/no-unsafe-member-access": "error",
			"typescript/no-unsafe-assignment": "error",
		},
		overrides: [
			{
				files: ["plugins/**/*.mjs"],
				rules: {
					// Untyped plain-JS plugin scripts: every value is `any`, so no-unsafe-* rules only add noise.
					"typescript/no-unsafe-member-access": "off",
					"typescript/no-unsafe-assignment": "off",
				},
			},
			{
				files: ["**/*.test.ts", "**/*.test.tsx", "**/*.test.mjs"],
				rules: {
					// Per-test fakes read better next to the assertion that uses them than hoisted to module scope.
					"unicorn/consistent-function-scoping": "off",
				},
			},
			{
				files: ["test/evals/**"],
				rules: {
					// LLM responses include optional fields, so evals assert on them only when present.
					"vitest/no-conditional-expect": "off",
				},
			},
			{
				files: ["plugins/**/*.test.mjs"],
				rules: {
					// These run under node:test; the rule mistakes its `test` import for a Vitest global.
					"vitest/prefer-importing-vitest-globals": "off",
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
