import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite-plus';

export default defineConfig({
	root: 'src/client',
	server: {
		port: 5173,
		allowedHosts: process.env['VITE_ALLOWED_HOSTS']?.split(',').filter(Boolean) ?? [],
		proxy: {
			'/api': 'http://localhost:3000',
		},
	},
	build: {
		outDir: '../../dist/client',
	},
	plugins: [react()],
});
