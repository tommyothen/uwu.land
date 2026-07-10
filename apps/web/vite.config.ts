import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		cloudflare({ viteEnvironment: { name: "ssr" } }),
		tailwindcss(),
		reactRouter()
	],
	server: {
		port: 3000,
		// The worker's CORS allowlist only has localhost:3000 — fail loudly
		// instead of silently drifting to 3001 when the port is taken.
		strictPort: true
	},
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url))
		}
	},
	ssr: {
		noExternal: ["@clerk/react-router"]
	}
});
