import path from "node:path";
import {
	cloudflareTest,
	readD1Migrations
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		cloudflareTest(async () => ({
			wrangler: {
				configPath: "./wrangler.jsonc"
			},
			miniflare: {
				bindings: {
					TEST_MIGRATIONS: await readD1Migrations(
						path.resolve(__dirname, "../../packages/db/migrations")
					)
				}
			}
		}))
	]
});
