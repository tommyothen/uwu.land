import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Turnstile } from "./turnstile";

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

/**
 * Mounts the hook with a real container, as ShortenBox does. `showForm` mirrors
 * the form unmounting while the result card is up.
 */
async function mount(enabled: boolean) {
	// Fresh module per test: the script loader is cached at module scope.
	const { useTurnstile } = await import("./turnstile");
	let latest: Turnstile | null = null;
	function Harness({ on, showForm }: { on: boolean; showForm: boolean }) {
		latest = useTurnstile(on);
		return showForm ? <div ref={latest.containerRef} /> : null;
	}
	const view = render(<Harness on={enabled} showForm />);
	return {
		turnstile: (): Turnstile => {
			if (latest === null) throw new Error("hook never rendered");
			return latest;
		},
		rerender: (props: { on: boolean; showForm: boolean }) =>
			view.rerender(<Harness {...props} />)
	};
}

async function finishScriptLoad() {
	window.turnstile = api;
	await act(async () => {
		scripts()[0]?.dispatchEvent(new Event("load"));
	});
}

async function failScriptLoad() {
	await act(async () => {
		scripts()[0]?.dispatchEvent(new Event("error"));
	});
}

/** Options for the most recently rendered widget. */
function renderedOptions(): RenderOptions {
	const call = api.render.mock.calls.at(-1);
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
		const { turnstile } = await mount(false);

		expect(scripts()).toHaveLength(0);
		await expect(turnstile().takeToken()).rejects.toThrow("not active");
	});

	it("renders an interaction-only Managed widget with the test key once enabled", async () => {
		const view = await mount(false);
		view.rerender({ on: true, showForm: true });
		expect(scripts()).toHaveLength(1);

		await finishScriptLoad();

		expect(renderedOptions()).toMatchObject({
			sitekey: "1x00000000000000000000AA",
			appearance: "interaction-only",
			"response-field": false
		});
	});

	it("hands each token over once and queues a fresh challenge", async () => {
		const { turnstile } = await mount(true);
		await finishScriptLoad();

		const first = turnstile().takeToken();
		act(() => renderedOptions().callback("tok_1"));
		await expect(first).resolves.toBe("tok_1");
		expect(api.reset).toHaveBeenCalledWith("widget-1");

		const second = turnstile().takeToken();
		act(() => renderedOptions().callback("tok_2"));
		await expect(second).resolves.toBe("tok_2");
	});

	it("rejects a waiting send when the challenge errors, then recovers", async () => {
		const { turnstile } = await mount(true);
		await finishScriptLoad();

		const failed = turnstile().takeToken();
		act(() => renderedOptions()["error-callback"]());
		await expect(failed).rejects.toThrow("challenge failed");

		const retried = turnstile().takeToken();
		act(() => renderedOptions().callback("tok_retry"));
		await expect(retried).resolves.toBe("tok_retry");
	});

	it("renders a fresh widget when the form remounts for another send", async () => {
		const view = await mount(true);
		await finishScriptLoad();
		const first = view.turnstile().takeToken();
		act(() => renderedOptions().callback("tok_1"));
		await expect(first).resolves.toBe("tok_1");

		// The result card replaces the form, then "Send another" brings it back.
		view.rerender({ on: true, showForm: false });
		expect(api.remove).toHaveBeenCalledWith("widget-1");
		api.render.mockReturnValue("widget-2");
		await act(async () => view.rerender({ on: true, showForm: true }));

		expect(api.render).toHaveBeenCalledTimes(2);
		const second = view.turnstile().takeToken();
		act(() => renderedOptions().callback("tok_2"));
		await expect(second).resolves.toBe("tok_2");
	});

	it("reloads the script for the next send after a failed load", async () => {
		const { turnstile } = await mount(true);
		await failScriptLoad();
		expect(scripts()).toHaveLength(0);

		await act(async () => {
			await expect(turnstile().takeToken()).rejects.toThrow("failed to load");
		});
		expect(scripts()).toHaveLength(1);

		const retried = turnstile().takeToken();
		await finishScriptLoad();
		act(() => renderedOptions().callback("tok_after_reload"));
		await expect(retried).resolves.toBe("tok_after_reload");
	});
});
