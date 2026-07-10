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
		// IPv4 loopback explicitly: node's "localhost" default binds only [::1],
		// which breaks plain `ssh -L 3000:localhost:3000` tunnels.
		host: "127.0.0.1",
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
