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
			// ws so the ladder's write stream survives the dev proxy. The port
			// follows the API server's own PORT, so both can move off a busy 3000.
			'/api': {target: `http://127.0.0.1:${process.env.PORT ?? 3000}`, ws: true},
		},
	},
	build: {
		outDir: '../../dist/client',
	},
	plugins: [react()],
});
