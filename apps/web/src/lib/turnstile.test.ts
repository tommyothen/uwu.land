import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type TurnstileModule = typeof import("./turnstile");
type RenderOptions = Parameters<NonNullable<Window["turnstile"]>["render"]>[1];

const api = {
	render: vi.fn<(container: HTMLElement, options: RenderOptions) => string>(),
	reset: vi.fn(),
	remove: vi.fn()
};

function scripts(): HTMLScriptElement[] {
	return [
		...document.head.querySelectorAll<HTMLScriptElement>(
			'script[src^="https://challenges.cloudflare.com/turnstile/"]'
		)
	];
}

/** Mounts the hook with a real container, as ShortenBox would. */
async function mount(enabled: boolean) {
	// Fresh module per test: the script loader is cached at module scope.
	const { useTurnstile }: TurnstileModule = await import("./turnstile");
	const hook = renderHook(
		({ on }) => {
			const turnstile = useTurnstile(on);
			if (turnstile.containerRef.current === null) {
				turnstile.containerRef.current = document.createElement("div");
			}
			return turnstile;
		},
		{ initialProps: { on: enabled } }
	);
	return hook;
}

async function finishScriptLoad() {
	window.turnstile = api;
	await act(async () => {
		scripts()[0]?.dispatchEvent(new Event("load"));
	});
}

function renderedOptions(): RenderOptions {
	const call = api.render.mock.calls[0];
	if (call === undefined) throw new Error("widget was never rendered");
	return call[1];
}

beforeEach(() => {
	vi.resetModules();
	api.render.mockReturnValue("widget-1");
});

afterEach(() => {
	for (const script of scripts()) script.remove();
	window.turnstile = undefined;
	vi.clearAllMocks();
});

describe("useTurnstile", () => {
	it("loads no script while disabled", async () => {
		const { result } = await mount(false);

		expect(scripts()).toHaveLength(0);
		await expect(result.current.takeToken()).rejects.toThrow("not active");
	});

	it("renders an interaction-only Managed widget with the test key once enabled", async () => {
		const hook = await mount(false);
		hook.rerender({ on: true });
		expect(scripts()).toHaveLength(1);

		await finishScriptLoad();

		expect(renderedOptions()).toMatchObject({
			sitekey: "1x00000000000000000000AA",
			appearance: "interaction-only",
			"response-field": false
		});
	});

	it("hands each token over once and queues a fresh challenge", async () => {
		const { result } = await mount(true);
		await finishScriptLoad();

		const first = result.current.takeToken();
		act(() => renderedOptions().callback("tok_1"));
		await expect(first).resolves.toBe("tok_1");
		expect(api.reset).toHaveBeenCalledWith("widget-1");

		const second = result.current.takeToken();
		act(() => renderedOptions().callback("tok_2"));
		await expect(second).resolves.toBe("tok_2");
	});

	it("rejects a waiting send when the challenge errors, then recovers", async () => {
		const { result } = await mount(true);
		await finishScriptLoad();

		const failed = result.current.takeToken();
		act(() => renderedOptions()["error-callback"]());
		await expect(failed).rejects.toThrow("challenge failed");

		const retried = result.current.takeToken();
		act(() => renderedOptions().callback("tok_retry"));
		await expect(retried).resolves.toBe("tok_retry");
	});
});
