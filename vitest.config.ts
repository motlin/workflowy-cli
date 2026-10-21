import {defineConfig} from "vite-plus";

export default defineConfig({
	test: {
		globals: true,
		include: ["packages/*/test/**/*.test.ts", "scripts/**/*.test.mjs"],
		setupFiles: ["packages/cli/test/setup/oclif-root.ts"],
		globalSetup: ["packages/cli/test/setup/migrated-template.ts"],
		testTimeout: 60_000,
		// Trivial sync beforeEach hooks (mkdtemp + template DB copy) hit the 10s default when the machine is oversubscribed
		hookTimeout: 60_000,
		restoreMocks: true,
		reporters: ["verbose"],
		allowOnly: !process.env.CI,
		disableConsoleIntercept: true,
	},
});
