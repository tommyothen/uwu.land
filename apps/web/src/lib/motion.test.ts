import { afterEach, describe, expect, it, vi } from "vitest";
import { getGsap, loadGsap, prefersReducedMotion } from "./motion";

function setReducedMotion(reduced: boolean) {
	window.matchMedia = vi.fn().mockImplementation((query: string) => ({
		matches: reduced,
		media: query,
		onchange: null,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		addListener: vi.fn(),
		removeListener: vi.fn(),
		dispatchEvent: vi.fn()
	}));
}

afterEach(() => {
	setReducedMotion(false);
});

describe("motion loader", () => {
	it("reads the reduced-motion preference from matchMedia", () => {
		setReducedMotion(true);
		expect(prefersReducedMotion()).toBe(true);
		setReducedMotion(false);
		expect(prefersReducedMotion()).toBe(false);
	});

	it("resolves null without fetching gsap under reduced motion", async () => {
		setReducedMotion(true);
		await expect(loadGsap()).resolves.toBeNull();
	});

	it("caches one gsap instance and exposes it synchronously afterwards", async () => {
		setReducedMotion(false);
		const first = loadGsap();
		expect(loadGsap()).toBe(first);

		const gsap = await first;
		expect(gsap).not.toBeNull();
		expect(getGsap()).toBe(gsap);
	});
});
