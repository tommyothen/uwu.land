import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
	BADGE_INSET,
	badgeSquare,
	buildQrStamp,
	isUnderLabel,
	LABEL_MAX_RATIO,
	labelBox
} from "@/lib/qr";
import { QrStamp } from "./qr-stamp";

const URL = "https://uwu.land/aB3xK9";

describe("qr geometry", () => {
	it("keeps the badge module-aligned, centred and under the ratio cap", () => {
		for (const size of [21, 25, 37, 45, 57]) {
			const box = labelBox(size);
			expect(box.span / size).toBeLessThanOrEqual(LABEL_MAX_RATIO);
			// Symmetric around the middle: equal margin either side.
			expect(box.start * 2 + box.span).toBe(size);
			expect(Number.isInteger(box.start)).toBe(true);
		}
	});

	it("keeps the paper square strictly inside the cleared modules", () => {
		// The badge edge must never cut a module in half: every module it touches
		// has to be one the renderers already dropped.
		expect(BADGE_INSET).toBeGreaterThan(0);
		for (const size of [21, 25, 37, 45, 57]) {
			const box = labelBox(size);
			const square = badgeSquare(box);
			expect(square.offset).toBeGreaterThan(box.start);
			expect(square.offset + square.size).toBeLessThan(box.start + box.span);
			// Concentric with the cleared box.
			expect(square.offset + square.size / 2).toBeCloseTo(size / 2, 10);
		}
	});

	it("clears 11 modules of a version 5 symbol, inside level H's budget", () => {
		const stamp = buildQrStamp(URL);
		expect(stamp.size).toBe(37);
		expect(stamp.label.span).toBe(11);
		const covered = stamp.label.span ** 2 / stamp.size ** 2;
		// Level H recovers ~30%; 11x11 of 37x37 is ~8.8%.
		expect(covered).toBeLessThan(0.1);
	});

	it("never lets the badge sit on a finder pattern", () => {
		const stamp = buildQrStamp(URL);
		for (const finder of stamp.finders) {
			for (let dy = 0; dy < 7; dy += 1) {
				for (let dx = 0; dx < 7; dx += 1) {
					expect(isUnderLabel(stamp.label, finder.x + dx, finder.y + dy)).toBe(false);
				}
			}
		}
	});

	it("pins a minimum version so short slugs don't get a tiny symbol", () => {
		// Every uwu.land URL should land on the same version, badge included.
		expect(buildQrStamp("https://uwu.land/a").code.version).toBeGreaterThanOrEqual(5);
		expect(buildQrStamp(URL).code.version).toBeGreaterThanOrEqual(5);
	});

	it("omits every module hidden by the badge", () => {
		const stamp = buildQrStamp(URL);
		expect(stamp.dots.length).toBeGreaterThan(0);
		for (const dot of stamp.dots) {
			expect(isUnderLabel(stamp.label, dot.x, dot.y)).toBe(false);
		}
	});
});

describe("QrStamp", () => {
	it("renders a labelled symbol with the UwU / Land badge", () => {
		render(<QrStamp url={URL} slug="aB3xK9" />);
		const svg = screen.getByRole("img", { name: /qr code/i });
		expect(svg.textContent).toContain("UwU");
		expect(svg.textContent).toContain("Land");
	});

	it("draws modules as full-size touching circles", () => {
		const { container } = render(<QrStamp url={URL} slug="aB3xK9" />);
		const dot = container.querySelector("svg > g > rect");
		expect(dot?.getAttribute("width")).toBe("1");
		expect(dot?.getAttribute("height")).toBe("1");
		// rx of half a module turns the square into a circle.
		expect(dot?.getAttribute("rx")).toBe("0.5");
	});

	it("gives the badge a bare paper square — background, no outline", () => {
		const { container } = render(<QrStamp url={URL} slug="aB3xK9" />);
		const badge = container.querySelector(".qr-badge");
		expect(badge?.getAttribute("fill")).toBe("#ffffff");
		expect(badge?.getAttribute("stroke")).toBeNull();
	});

	it("offers a PNG download", () => {
		render(<QrStamp url={URL} slug="aB3xK9" />);
		expect(screen.getByRole("button", { name: /save png/i })).toBeVisible();
	});

	it("scopes gradient ids to the slug so two symbols don't collide", () => {
		const { container } = render(<QrStamp url={URL} slug="aB3xK9" />);
		const gradients = Array.from(container.querySelectorAll("linearGradient"));
		expect(gradients.map((node) => node.id)).toEqual([
			"qr-aB3xK9-modules",
			"qr-aB3xK9-badge"
		]);
	});
});
