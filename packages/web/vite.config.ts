import react from "@vitejs/plugin-react";
import {defineConfig} from "vite-plus";
import {resolvePort} from "./src/server/port.js";

process.title = "workflowy-web-dev";

export default defineConfig({
	root: "src/client",
	server: {
		port: 5175,
		strictPort: true,
		host: "127.0.0.1",
		allowedHosts: [
			"workflowy.m4.notlin.com",
			...(process.env["VITE_ALLOWED_HOSTS"]?.split(",").filter(Boolean) ?? []),
		],
		proxy: {
			// ws so the ladder's write stream survives the dev proxy. The port
			// follows the API server's own PORT, so both can move together.
			"/api": {target: `http://127.0.0.1:${resolvePort(process.env)}`, ws: true},
		},
	},
	build: {
		outDir: "../../dist/client",
		// outDir sits outside root (src/client), so Vite will not clear it unless told to.
		emptyOutDir: true,
		rolldownOptions: {
			output: {
				// Keep third-party code out of the app chunk so neither crosses the 500 kB warning limit.
				codeSplitting: {
					groups: [
						{name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/u},
						{name: "vendor", test: /node_modules/u},
					],
				},
			},
		},
	},
	plugins: [react()],
});
