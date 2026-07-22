import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite-plus';

export default defineConfig({
	root: 'src/client',
	server: {
		port: 5175,
		strictPort: true,
		host: '127.0.0.1',
		allowedHosts: [
			'workflowy.m4.notlin.com',
			...(process.env['VITE_ALLOWED_HOSTS']?.split(',').filter(Boolean) ?? []),
		],
		proxy: {
			'/api': 'http://127.0.0.1:3000',
		},
	},
	build: {
		outDir: '../../dist/client',
	},
	plugins: [react()],
});
