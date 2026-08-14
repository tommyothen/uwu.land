import { render, screen } from "@testing-library/react";
import { QrCodeDataType } from "uqr";
import { describe, expect, it } from "vitest";
import {
	BADGE_INSET,
	badgeSquare,
	buildQrStamp,
	CORNER_CLEAR,
	cornerBox,
	isUnderLabel
} from "@/lib/qr";
import { QrStamp } from "./qr-stamp";

const URL = "https://uwu.land/aB3xK9";

describe("qr geometry", () => {
	it("anchors the cleared box to the bottom-right corner, module-aligned", () => {
		for (const size of [21, 25, 29, 37, 45, 57]) {
			const box = cornerBox(size);
			expect(box.span).toBe(CORNER_CLEAR);
			expect(box.start + box.span).toBe(size);
			expect(Number.isInteger(box.start)).toBe(true);
		}
	});

	it("keeps the badge's in-symbol half strictly inside the cleared modules", () => {
		// The badge edge must never cut a module in half: every module it touches
		// has to be one the renderers already dropped. The other half hangs over
		// the quiet zone, where there are no modules to cut.
		expect(BADGE_INSET).toBeGreaterThan(0);
		for (const size of [21, 25, 29, 37, 45, 57]) {
			const box = cornerBox(size);
			const square = badgeSquare(size);
			expect(square.offset).toBeGreaterThan(box.start);
			// Centred on the corner point, symmetric into symbol and quiet zone.
			expect(square.offset + square.size / 2).toBeCloseTo(size, 10);
			// Stays within the 4-module quiet zone on the outside.
			expect(square.offset + square.size).toBeLessThan(size + 4);
		}
	});

	it("clears a corner well inside level M's budget", () => {
		const stamp = buildQrStamp(URL);
		expect(stamp.size).toBe(25);
		const covered = stamp.label.span ** 2 / stamp.size ** 2;
		// Level M recovers ~15%; 4x4 of 25x25 is ~2.6%.
		expect(covered).toBeLessThan(0.05);
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

	it("never lets the badge sit on an alignment pattern", () => {
		// The bottom-right alignment pattern ends at size-5 on every version;
		// the cleared corner starts at size-4. Losing it would cost the scanner
		// its geometry correction, which ECC can't buy back.
		for (const slug of ["a", "aB3xK9", "a-much-longer-custom-slug"]) {
			const stamp = buildQrStamp(`https://uwu.land/${slug}`);
			for (let y = 0; y < stamp.size; y += 1) {
				for (let x = 0; x < stamp.size; x += 1) {
					if (stamp.code.types[y]?.[x] !== QrCodeDataType.Alignment) continue;
					expect(isUnderLabel(stamp.label, x, y)).toBe(false);
				}
			}
		}
	});

	it("pins a minimum version so every standard slug gets the same symbol", () => {
		expect(buildQrStamp("https://uwu.land/a").code.version).toBe(2);
		expect(buildQrStamp(URL).code.version).toBe(2);
	});

	it("omits every module hidden by the badge", () => {
		const stamp = buildQrStamp(URL);
		expect(stamp.dots.length).toBeGreaterThan(0);
		for (const dot of stamp.dots) {
			expect(isUnderLabel(stamp.label, dot.x, dot.y)).toBe(false);
		}
	});

	it("bakes every dot into the single path, one circle each", () => {
		const stamp = buildQrStamp(URL);
		const circles = stamp.path.match(/M[\d. -]+a\.5 \.5/g) ?? [];
		expect(circles.length).toBe(stamp.dots.length);
	});
});

describe("QrStamp", () => {
	it("renders a labelled symbol with the UwU / Land badge", () => {
		render(<QrStamp url={URL} slug="aB3xK9" />);
		const svg = screen.getByRole("img", { name: /qr code/i });
		expect(svg.textContent).toContain("UwU");
		expect(svg.textContent).toContain("Land");
	});

	it("draws all data modules as one path element", () => {
		const { container } = render(<QrStamp url={URL} slug="aB3xK9" />);
		const paths = container.querySelectorAll(".qr-stamp-svg path");
		expect(paths.length).toBe(1);
		expect(paths[0]?.getAttribute("fill")).toBe("url(#qr-aB3xK9-modules)");
	});

	it("gives the badge a bare paper square — background, no outline", () => {
		const { container } = render(<QrStamp url={URL} slug="aB3xK9" />);
		const badge = container.querySelector(".qr-badge");
		expect(badge?.getAttribute("fill")).toBe("#ffffff");
		expect(badge?.getAttribute("stroke")).toBeNull();
	});

	it("offers a PNG download", () => {
		render(<QrStamp url={URL} slug="aB3xK9" />);
		expect(screen.getByRole("button", { name: /save qr code as png/i })).toBeVisible();
	});

	it("offers an accessible enlarged view", () => {
		render(<QrStamp url={URL} slug="aB3xK9" />);
		expect(screen.getByRole("button", { name: /enlarge qr code/i })).toBeVisible();
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
