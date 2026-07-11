import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { syncBannedDomains } from "../src/ban-sync";

async function clearKv(namespace: KVNamespace): Promise<void> {
	const list = await namespace.list();
	await Promise.all(list.keys.map((key) => namespace.delete(key.name)));
}

describe("banned-domain sync", () => {
	beforeEach(async () => {
		await clearKv(env.UWU);
	});

	it("adds new valid domains as auto while preserving manual entries", async () => {
		await env.UWU.put("banned:manual.example", "1");

		const result = await syncBannedDomains(
			{ UWU: env.UWU },
			async () =>
				new Response(
					"# comment\nmanual.example\nNew.Example\ninvalid\nother.example\n"
				)
		);

		expect(result).toEqual({ added: 2, scanned: 3 });
		expect(await env.UWU.get("banned:manual.example")).toBe("1");
		expect(await env.UWU.get("banned:new.example")).toBe("auto");
		expect(await env.UWU.get("banned:other.example")).toBe("auto");
	});

	it("does not add anything when the fetch fails or returns no domains", async () => {
		await env.UWU.put("banned:manual.example", "1");

		await expect(
			syncBannedDomains({ UWU: env.UWU }, async () => {
				throw new Error("network failure");
			})
		).resolves.toEqual({ added: 0, scanned: 0 });
		await expect(
			syncBannedDomains(
				{ UWU: env.UWU },
				async () => new Response("# only a comment\nnot-a-domain")
			)
		).resolves.toEqual({ added: 0, scanned: 0 });
		expect(await env.UWU.get("banned:manual.example")).toBe("1");
	});
});
