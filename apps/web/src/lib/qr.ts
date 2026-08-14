import { encode, QrCodeDataType, type QrCodeGenerateResult } from "uqr";

/**
 * Geometry + palette for the branded QR stamp. Kept out of the component so the
 * numbers that decide whether the thing still scans are testable on their own.
 */

/**
 * Level M recovers ~15% of the symbol; the corner badge erases ~2.6%, leaving
 * a wide margin. M rather than Q or H because it's what lets standard URLs
 * land on version 2 — the smallest symbol our URLs can reach without going
 * uppercase-only. boostEcc still promotes short slugs back toward Q for free.
 */
const ECC = "M" as const;

/**
 * Four modules of quiet zone — below that, scanners start missing the symbol
 * entirely no matter how clean the modules are.
 */
export const QR_BORDER = 4;

/**
 * Standard uwu.land URLs all land on version 2 at level M; pinning the floor
 * keeps every delivered symbol the same size whatever the slug turns out to
 * be. Long custom slugs (10+ chars) still push past it naturally.
 */
const MIN_VERSION = 2;

/**
 * How many modules the badge clears off the bottom-right corner, per axis.
 * A 4x4 corner never reaches the bottom-right alignment pattern: its centre
 * sits at size-7, so it ends at size-5 on every version.
 */
export const CORNER_CLEAR = 4;

/**
 * How far the paper square stays inside the cleared corner, per in-symbol
 * side. It has to be strictly positive: the cleared box must fully contain
 * the square, or the badge edge slices through modules it only half covers.
 */
export const BADGE_INSET = 0.6;

/**
 * Brand palette, hard-coded rather than read off the theme: the export has to
 * stay dark-on-light in both themes, since inverted symbols trip up a good
 * share of phone scanners. Both module colours clear 5.6:1 on white.
 */
export const QR_PALETTE = {
	/** Page background, so the stamp sits on paper rather than a white hole. */
	paper: "#ffffff",
	/** --grad-a: the indigo end of the wordmark gradient. */
	gradientFrom: "#4f39fa",
	/** --stamp: the magenta the postal chrome already uses. */
	gradientTo: "#b13094",
	/** --foreground: finders get the full ink weight so they read as anchors. */
	ink: "#2b2547",
	/** --grad-b: the wordmark's pink, badge text only (too light for modules). */
	blush: "#da62c4"
} as const;

export interface LabelBox {
	/** Module column/row the cleared corner starts at, and how many it spans. */
	start: number;
	span: number;
}

/** The cleared square in the symbol's bottom-right corner, module-aligned. */
export function cornerBox(size: number): LabelBox {
	return { start: size - CORNER_CLEAR, span: CORNER_CLEAR };
}

/**
 * The paper square itself, in module units from the symbol's top-left. It is
 * centred on the bottom-right corner point: half sits over cleared modules
 * (strictly inside them, by BADGE_INSET), half hangs out into the quiet zone.
 */
export function badgeSquare(size: number): { offset: number; size: number } {
	const reach = CORNER_CLEAR - BADGE_INSET;
	return { offset: size - reach, size: reach * 2 };
}

export function isUnderLabel(box: LabelBox, x: number, y: number): boolean {
	return (
		x >= box.start &&
		x < box.start + box.span &&
		y >= box.start &&
		y < box.start + box.span
	);
}

/**
 * All data modules as one SVG path: a pair of half-circle arcs per module.
 * One node with a single gradient fill instead of one element per module
 * (a typical symbol has hundreds of them, twice per page).
 */
export function dotsPath(
	dots: Array<{ x: number; y: number }>,
	border: number
): string {
	return dots
		.map(({ x, y }) => {
			const cx = border + x + 0.5;
			const cy = border + y + 0.5;
			return `M${cx - 0.5} ${cy}a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0`;
		})
		.join("");
}

export interface QrStamp {
	code: QrCodeGenerateResult;
	/** Symbol width in modules, quiet zone excluded. */
	size: number;
	label: LabelBox;
	/** Finder-pattern top-left corners, in module coordinates. */
	finders: Array<{ x: number; y: number }>;
	/** Every dark module that isn't part of a finder or hidden by the badge. */
	dots: Array<{ x: number; y: number }>;
	/** `dots` as a single SVG path, quiet zone offset baked in. */
	path: string;
}

/** Encodes `text` and pre-computes everything the renderers draw. */
export function buildQrStamp(text: string): QrStamp {
	const code = encode(text, {
		ecc: ECC,
		border: 0,
		minVersion: MIN_VERSION,
		boostEcc: true
	});
	const size = code.size;
	const label = cornerBox(size);
	const finders = [
		{ x: 0, y: 0 },
		{ x: size - 7, y: 0 },
		{ x: 0, y: size - 7 }
	];

	const dots: Array<{ x: number; y: number }> = [];
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			if (!code.data[y]?.[x]) continue;
			if (code.types[y]?.[x] === QrCodeDataType.Position) continue;
			if (isUnderLabel(label, x, y)) continue;
			dots.push({ x, y });
		}
	}

	return { code, size, label, finders, dots, path: dotsPath(dots, QR_BORDER) };
}
