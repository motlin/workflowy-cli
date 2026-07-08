import {defineConfig} from 'vite-plus';

export default defineConfig({
	test: {
		globals: true,
		include: ['packages/*/test/**/*.test.ts'],
		testTimeout: 60_000,
		restoreMocks: true,
		reporters: ['verbose'],
		allowOnly: !process.env.CI,
		disableConsoleIntercept: true,
	},
});
