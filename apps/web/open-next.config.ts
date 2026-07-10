import {
	defineCloudflareConfig,
	type OpenNextConfig
} from "@opennextjs/cloudflare";

const config: OpenNextConfig = {
	...defineCloudflareConfig(),
	// Always run Next's build directly. Never point this (or the package `build`
	// script the OpenNext CLI would otherwise invoke) back at
	// `opennextjs-cloudflare build` — that recurses and fork-bombs the machine.
	buildCommand: "pnpm exec next build"
};

export default config;
