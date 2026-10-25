import {defineConfig} from "vite-plus";

export default defineConfig({
	test: {
		globals: true,
		testTimeout: 60_000,
		// Trivial sync beforeEach hooks (mkdtemp + template DB copy) hit the 10s default when the machine is oversubscribed
		hookTimeout: 60_000,
		restoreMocks: true,
		reporters: ["verbose"],
		allowOnly: !process.env.CI,
		disableConsoleIntercept: true,
		// Files stay module-isolated, so every setup file is re-imported per test file: only the packages that run oclif commands or copy the migrated database pay for @oclif/core and the template.
		projects: [
			{
				extends: true,
				test: {
					name: "cli",
					include: ["packages/cli/test/**/*.test.ts", "packages/mcp/test/**/*.test.ts"],
					setupFiles: ["packages/cli/test/setup/oclif-root.ts"],
					globalSetup: ["packages/cli/test/setup/migrated-template.ts"],
				},
			},
			{
				extends: true,
				test: {
					name: "unit",
					include: [
						"packages/shared/test/**/*.test.ts",
						"packages/web/test/**/*.test.{ts,tsx}",
						"scripts/**/*.test.mjs",
					],
				},
			},
		],
	},
});
