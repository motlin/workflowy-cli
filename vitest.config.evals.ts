import {defineConfig} from 'vite-plus';

export default defineConfig({
	test: {
		globals: true,
		include: ['test/evals/**/*.{test,eval}.ts'],
		testTimeout: 120_000,
		restoreMocks: true,
		reporters: ['verbose'],
		disableConsoleIntercept: true,
	},
});
