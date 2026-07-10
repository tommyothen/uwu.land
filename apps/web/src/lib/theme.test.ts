import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, getTheme, setTheme } from "./theme";

let stored = new Map<string, string>();

beforeEach(() => {
	stored = new Map();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => stored.get(key) ?? null,
		setItem: (key: string, value: string) => stored.set(key, value),
		clear: () => stored.clear()
	});
});

afterEach(() => {
	document.documentElement.classList.remove("dark");
	vi.unstubAllGlobals();
});

describe("theme", () => {
	it("prefers a stored setting over the system preference", () => {
		vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
		localStorage.setItem("uwu-theme", "light");

		expect(getTheme()).toBe("light");
	});

	it("uses the system preference and toggles the document class", () => {
		vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));

		expect(applyTheme()).toBe("dark");
		expect(document.documentElement).toHaveClass("dark");
		setTheme("light");
		expect(document.documentElement).not.toHaveClass("dark");
		expect(localStorage.getItem("uwu-theme")).toBe("light");
	});
});
