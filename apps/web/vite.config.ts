import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [cloudflare(), tailwindcss(), reactRouter()],
	server: {
		port: 3000
	},
	ssr: {
		noExternal: ["@clerk/react-router"]
	}
});
