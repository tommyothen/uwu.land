import { useMemo, useState } from "react";
import {
	badgeSquare,
	buildQrStamp,
	QR_BORDER,
	QR_PALETTE,
	type QrStamp as Stamp
} from "@/lib/qr";

/**
 * The QR stamp: the delivered short link as a scannable, on-brand symbol.
 *
 * Preview is inline SVG (crisp at any size, themes with the page); the PNG
 * download is a separate canvas draw rather than a rasterised copy of that SVG,
 * because an SVG loaded into an `Image` can't reach the document's webfonts and
 * the badge would silently fall back to a system face in the file.
 */

/** Downloaded PNG edge, in device pixels. */
const EXPORT_PX = 1024;

/**
 * Corner rounding of a data module, as a share of the module. Half a module
 * makes each one a full-size circle that just touches its neighbours.
 */
const DOT_RADIUS = 0.5;

const BADGE_RADIUS = 1.9;

const DISPLAY_FONT = '"Bricolage Grotesque Variable", sans-serif';

/**
 * Baselines and sizes for "UwU" / "Land", in module units. The pair is centred
 * as one block: the baselines are offsets from the middle of the badge.
 */
const UWU_SIZE = 3.8;
const LAND_SIZE = 3.13;
const UWU_BASELINE = -0.25;
const LAND_BASELINE = 2.79;

/** The rounded ring + pupil of one finder pattern, in module units. */
function finderShapes(x: number, y: number) {
	return {
		ring: { x: x + 0.5, y: y + 0.5, size: 6, radius: 1.9 },
		pupil: { x: x + 2, y: y + 2, size: 3, radius: 0.9 }
	};
}

function QrSvg({ stamp, id }: { stamp: Stamp; id: string }) {
	const extent = stamp.size + QR_BORDER * 2;
	const centre = QR_BORDER + stamp.label.start + stamp.label.span / 2;
	const square = badgeSquare(stamp.label);
	const badge = { x: QR_BORDER + square.offset, size: square.size };

	return (
		<svg
			viewBox={`0 0 ${extent} ${extent}`}
			className="qr-stamp-svg"
			role="img"
			aria-label="QR code for the short link"
		>
			<title>QR code for the short link</title>
			<defs>
				<linearGradient id={`${id}-modules`} x1="0" y1="0" x2="1" y2="1">
					<stop offset="0%" stopColor={QR_PALETTE.gradientFrom} />
					<stop offset="100%" stopColor={QR_PALETTE.gradientTo} />
				</linearGradient>
				<linearGradient id={`${id}-badge`} x1="0" y1="1" x2="1" y2="0">
					<stop offset="0%" stopColor={QR_PALETTE.gradientFrom} />
					<stop offset="100%" stopColor={QR_PALETTE.blush} />
				</linearGradient>
			</defs>

			<rect width={extent} height={extent} fill={QR_PALETTE.paper} rx="2" />

			<g fill={`url(#${id}-modules)`}>
				{stamp.dots.map((dot) => (
					<rect
						key={`${dot.x}-${dot.y}`}
						x={QR_BORDER + dot.x}
						y={QR_BORDER + dot.y}
						width={1}
						height={1}
						rx={DOT_RADIUS}
					/>
				))}
			</g>

			<g fill="none" stroke={QR_PALETTE.ink}>
				{stamp.finders.map((finder) => {
					const { ring, pupil } = finderShapes(
						QR_BORDER + finder.x,
						QR_BORDER + finder.y
					);
					return (
						<g key={`${finder.x}-${finder.y}`}>
							<rect
								x={ring.x}
								y={ring.y}
								width={ring.size}
								height={ring.size}
								rx={ring.radius}
								strokeWidth={1}
							/>
							<rect
								x={pupil.x}
								y={pupil.y}
								width={pupil.size}
								height={pupil.size}
								rx={pupil.radius}
								fill={QR_PALETTE.ink}
							/>
						</g>
					);
				})}
			</g>

			{/* No stroke: the paper square alone gives the label its separation. */}
			<rect
				className="qr-badge"
				x={badge.x}
				y={badge.x}
				width={badge.size}
				height={badge.size}
				rx={BADGE_RADIUS}
				fill={QR_PALETTE.paper}
			/>
			<text
				textAnchor="middle"
				fontFamily={DISPLAY_FONT}
				letterSpacing="-0.02em"
			>
				<tspan
					x={centre}
					y={centre + UWU_BASELINE}
					fontSize={UWU_SIZE}
					fontWeight={800}
					fill={`url(#${id}-badge)`}
				>
					UwU
				</tspan>
				<tspan
					x={centre}
					y={centre + LAND_BASELINE}
					fontSize={LAND_SIZE}
					fontWeight={500}
					fill={QR_PALETTE.ink}
				>
					Land
				</tspan>
			</text>
		</svg>
	);
}

/** Redraws the symbol on a canvas at export resolution and hands back a blob. */
async function renderPng(stamp: Stamp): Promise<Blob | null> {
	const extent = stamp.size + QR_BORDER * 2;
	const unit = EXPORT_PX / extent;
	const canvas = document.createElement("canvas");
	canvas.width = EXPORT_PX;
	canvas.height = EXPORT_PX;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;

	// fillText only reaches a webfont once it's actually loaded.
	await document.fonts?.ready;

	const px = (modules: number) => modules * unit;

	ctx.fillStyle = QR_PALETTE.paper;
	ctx.fillRect(0, 0, EXPORT_PX, EXPORT_PX);

	const modules = ctx.createLinearGradient(0, 0, EXPORT_PX, EXPORT_PX);
	modules.addColorStop(0, QR_PALETTE.gradientFrom);
	modules.addColorStop(1, QR_PALETTE.gradientTo);
	ctx.fillStyle = modules;
	for (const dot of stamp.dots) {
		ctx.beginPath();
		ctx.roundRect(
			px(QR_BORDER + dot.x),
			px(QR_BORDER + dot.y),
			unit,
			unit,
			px(DOT_RADIUS)
		);
		ctx.fill();
	}

	ctx.strokeStyle = QR_PALETTE.ink;
	ctx.lineWidth = unit;
	for (const finder of stamp.finders) {
		const { ring, pupil } = finderShapes(
			QR_BORDER + finder.x,
			QR_BORDER + finder.y
		);
		ctx.beginPath();
		ctx.roundRect(px(ring.x), px(ring.y), px(ring.size), px(ring.size), px(ring.radius));
		ctx.stroke();
		ctx.fillStyle = QR_PALETTE.ink;
		ctx.beginPath();
		ctx.roundRect(
			px(pupil.x),
			px(pupil.y),
			px(pupil.size),
			px(pupil.size),
			px(pupil.radius)
		);
		ctx.fill();
	}

	const square = badgeSquare(stamp.label);
	const badgeX = px(QR_BORDER + square.offset);
	const badgeSize = px(square.size);
	ctx.fillStyle = QR_PALETTE.paper;
	ctx.beginPath();
	ctx.roundRect(badgeX, badgeX, badgeSize, badgeSize, px(BADGE_RADIUS));
	ctx.fill();

	const centre = px(QR_BORDER + stamp.label.start + stamp.label.span / 2);
	ctx.textAlign = "center";
	ctx.textBaseline = "alphabetic";

	const badgeText = ctx.createLinearGradient(
		badgeX,
		badgeX + badgeSize,
		badgeX + badgeSize,
		badgeX
	);
	badgeText.addColorStop(0, QR_PALETTE.gradientFrom);
	badgeText.addColorStop(1, QR_PALETTE.blush);
	ctx.fillStyle = badgeText;
	ctx.font = `800 ${px(UWU_SIZE)}px ${DISPLAY_FONT}`;
	ctx.fillText("UwU", centre, centre + px(UWU_BASELINE));

	ctx.fillStyle = QR_PALETTE.ink;
	ctx.font = `500 ${px(LAND_SIZE)}px ${DISPLAY_FONT}`;
	ctx.fillText("Land", centre, centre + px(LAND_BASELINE));

	return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export function QrStamp({ url, slug }: { url: string; slug: string }) {
	const [saving, setSaving] = useState(false);
	const stamp = useMemo(() => buildQrStamp(url), [url]);
	// Ids have to be unique per symbol: two gradients sharing an id would let
	// the first one win for both.
	const id = useMemo(() => `qr-${slug}`, [slug]);

	async function download() {
		if (saving) return;
		setSaving(true);
		try {
			const blob = await renderPng(stamp);
			if (!blob) return;
			const href = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = href;
			anchor.download = `uwu-land-${slug}.png`;
			anchor.click();
			URL.revokeObjectURL(href);
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="qr-stamp">
			<div className="qr-stamp-frame">
				<QrSvg stamp={stamp} id={id} />
			</div>
			<button type="button" onClick={download} disabled={saving} className="qr-stamp-save">
				{saving ? "printing…" : "save PNG"}
			</button>
		</div>
	);
}
