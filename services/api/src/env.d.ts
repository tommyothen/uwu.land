import type { Env as WorkerEnv } from "./worker";

declare global {
	namespace Cloudflare {
		interface Env extends WorkerEnv {}
	}
}
