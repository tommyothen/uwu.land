import { encode, QrCodeDataType, type QrCodeGenerateResult } from "uqr";

/**
 * Geometry + palette for the branded QR stamp. Kept out of the component so the
 * numbers that decide whether the thing still scans are testable on their own.
 */

/**
 * Level H recovers ~30% of the symbol, which is what pays for the UwU.Land
 * badge sitting on top of the middle of it.
 */
const ECC = "H" as const;

/**
 * Four modules of quiet zone — below that, scanners start missing the symbol
 * entirely no matter how clean the modules are.
 */
export const QR_BORDER = 4;

/**
 * uwu.land URLs are short enough to land on version 1-2, where a centre badge
 * would swallow a third of the symbol. Pinning a floor keeps the badge at a
 * stable, modest fraction of the width whatever the slug turns out to be.
 */
const MIN_VERSION = 5;

/** The badge may never cover more than this share of the symbol's width. */
export const LABEL_MAX_RATIO = 0.3;

/**
 * How far the paper square sits inside the cleared module box, per side. It has
 * to be strictly positive: the cleared box must fully contain the square, or
 * the badge edge slices through modules it only half covers.
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
	/** Module column/row the badge starts at, and how many modules it spans. */
	start: number;
	span: number;
}

/**
 * The centred, module-aligned square the badge occupies. Odd span keeps it
 * symmetric around the middle module; the ratio cap is enforced by shrinking,
 * never by growing.
 */
export function labelBox(size: number): LabelBox {
	let span = Math.floor(size * LABEL_MAX_RATIO);
	if (span % 2 !== size % 2) span -= 1;
	return { start: (size - span) / 2, span };
}

/**
 * The paper square itself, in module units, offset from the symbol's top-left.
 * Always strictly inside the cleared box, so every module it touches is one the
 * renderers already dropped — nothing gets sliced by the badge edge.
 */
export function badgeSquare(box: LabelBox): { offset: number; size: number } {
	return {
		offset: box.start + BADGE_INSET,
		size: box.span - BADGE_INSET * 2
	};
}

export function isUnderLabel(box: LabelBox, x: number, y: number): boolean {
	return (
		x >= box.start &&
		x < box.start + box.span &&
		y >= box.start &&
		y < box.start + box.span
	);
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
	const label = labelBox(size);
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

	return { code, size, label, finders, dots };
}
