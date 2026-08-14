import { Download, Expand } from "lucide-react";
import { useMemo, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
	DialogTrigger
} from "@/components/ui/dialog";
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

const DISPLAY_FONT = '"Bricolage Grotesque Variable", sans-serif';

/**
 * Badge metrics as fractions of the badge's edge, so the corner tag can be
 * resized in one place. Baselines are offsets from the badge's centre — the
 * symbol's bottom-right corner point — for the "UwU" / "Land" pair, centred
 * as one block.
 */
const BADGE_RADIUS_RATIO = 0.19;
const UWU_SIZE_RATIO = 0.39;
const LAND_SIZE_RATIO = 0.32;
const UWU_BASELINE_RATIO = -0.026;
const LAND_BASELINE_RATIO = 0.285;

/** The rounded ring + pupil of one finder pattern, in module units. */
function finderShapes(x: number, y: number) {
	return {
		ring: { x: x + 0.5, y: y + 0.5, size: 6, radius: 1.9 },
		pupil: { x: x + 2, y: y + 2, size: 3, radius: 0.9 }
	};
}

function QrSvg({ stamp, id }: { stamp: Stamp; id: string }) {
	const extent = stamp.size + QR_BORDER * 2;
	// The badge is centred on the symbol's bottom-right corner point.
	const centre = QR_BORDER + stamp.size;
	const square = badgeSquare(stamp.size);
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

			{/* Every data module in one node: ~600 circles as a single path. */}
			<path d={stamp.path} fill={`url(#${id}-modules)`} />

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
				rx={badge.size * BADGE_RADIUS_RATIO}
				fill={QR_PALETTE.paper}
			/>
			<text
				textAnchor="middle"
				fontFamily={DISPLAY_FONT}
				letterSpacing="-0.02em"
			>
				<tspan
					x={centre}
					y={centre + badge.size * UWU_BASELINE_RATIO}
					fontSize={badge.size * UWU_SIZE_RATIO}
					fontWeight={800}
					fill={`url(#${id}-badge)`}
				>
					UwU
				</tspan>
				<tspan
					x={centre}
					y={centre + badge.size * LAND_BASELINE_RATIO}
					fontSize={badge.size * LAND_SIZE_RATIO}
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

	// One fill for all data modules; the path is in module units, so scale the
	// context instead of rebuilding it in pixels. Gradient coords follow the
	// scaled space.
	const modules = ctx.createLinearGradient(0, 0, extent, extent);
	modules.addColorStop(0, QR_PALETTE.gradientFrom);
	modules.addColorStop(1, QR_PALETTE.gradientTo);
	ctx.save();
	ctx.scale(unit, unit);
	ctx.fillStyle = modules;
	ctx.fill(new Path2D(stamp.path));
	ctx.restore();

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

	const square = badgeSquare(stamp.size);
	const badgeX = px(QR_BORDER + square.offset);
	const badgeSize = px(square.size);
	ctx.fillStyle = QR_PALETTE.paper;
	ctx.beginPath();
	ctx.roundRect(badgeX, badgeX, badgeSize, badgeSize, badgeSize * BADGE_RADIUS_RATIO);
	ctx.fill();

	const centre = px(QR_BORDER + stamp.size);
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
	ctx.font = `800 ${badgeSize * UWU_SIZE_RATIO}px ${DISPLAY_FONT}`;
	ctx.fillText("UwU", centre, centre + badgeSize * UWU_BASELINE_RATIO);

	ctx.fillStyle = QR_PALETTE.ink;
	ctx.font = `500 ${badgeSize * LAND_SIZE_RATIO}px ${DISPLAY_FONT}`;
	ctx.fillText("Land", centre, centre + badgeSize * LAND_BASELINE_RATIO);

	return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export function QrStamp({
	url,
	slug,
	onAnnounce
}: {
	url: string;
	slug: string;
	onAnnounce?: (message: string) => void;
}) {
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const stamp = useMemo(() => buildQrStamp(url), [url]);
	// Ids have to be unique per symbol: two gradients sharing an id would let
	// the first one win for both.
	const id = useMemo(() => `qr-${slug}`, [slug]);

	async function download() {
		if (saving) return;
		setSaving(true);
		setSaveError(null);
		onAnnounce?.("Preparing QR image");
		try {
			const blob = await renderPng(stamp);
			if (!blob) throw new Error("Canvas export returned no image");
			const href = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = href;
			anchor.download = `uwu-land-${slug}.png`;
			anchor.click();
			URL.revokeObjectURL(href);
			onAnnounce?.("QR image downloaded");
		} catch {
			const message = "Couldn’t prepare the QR image. Try again.";
			setSaveError(message);
			onAnnounce?.(message);
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="qr-stamp">
			<div className="qr-stamp-frame">
				<QrSvg stamp={stamp} id={id} />
			</div>
			<fieldset className="qr-stamp-actions" aria-label="QR code actions">
				<button
					type="button"
					onClick={download}
					disabled={saving}
					className="qr-stamp-action"
					aria-label={saving ? "Saving QR code PNG" : "Save QR code as PNG"}
					title={saving ? "Saving…" : "Save PNG"}
				>
					<Download size={16} strokeWidth={2.25} aria-hidden="true" />
					<span>{saving ? "Saving…" : saveError ? "Retry" : "Save"}</span>
				</button>
				<Dialog>
					<DialogTrigger asChild>
						<button
							type="button"
							className="qr-stamp-action"
							aria-label="Enlarge QR code"
							title="Enlarge QR code"
						>
							<Expand size={16} strokeWidth={2.25} aria-hidden="true" />
							<span>Enlarge</span>
						</button>
					</DialogTrigger>
					<DialogContent className="qr-stamp-dialog sm:max-w-[440px]">
						<DialogTitle className="qr-stamp-dialog-title">Scan to open</DialogTitle>
						<DialogDescription className="qr-stamp-dialog-description">
							Scan this enlarged QR code to open the short link.
						</DialogDescription>
						<div className="qr-stamp-dialog-code">
							<QrSvg stamp={stamp} id={`${id}-large`} />
						</div>
						<p className="qr-stamp-dialog-url">{url.replace(/^https?:\/\//, "")}</p>
					</DialogContent>
				</Dialog>
				{saveError && <p className="qr-stamp-error">{saveError}</p>}
			</fieldset>
		</div>
	);
}
