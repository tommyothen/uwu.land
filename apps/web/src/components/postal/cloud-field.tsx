import { CLOUD_PATHS, CLOUD_VIEWBOX } from "@/lib/cloud-paths";

/**
 * The riso cloud field: the three v1 wave contours reprinted as flat risograph
 * plates, stacked back-to-front (cloud-1 under cloud-2 under cloud-3). Each
 * plate carries a small registration offset and multiplies over the lavender
 * paper (light mode), the way overlapping riso passes never line up perfectly.
 * Grain concentrates here via the `.cloud-field::after` ink layer (spec §3).
 *
 * The plates stretch to their box (`preserveAspectRatio="none"`) rather than
 * cover it. `slice` scaled the artwork to the viewport width against a band of
 * fixed height, so past ~1240px it ran out of band and chopped the crests flat
 * along the top edge. The box is now sized in CSS (`--plate-w`): natural width
 * and centre-cropped while the viewport is narrower than the artwork, widened
 * to the viewport beyond that. Vertically it always maps 1:1 onto the band, so
 * nothing can be cut off the top. Keep the `--cloud-mask` data URI in app.css
 * on this viewBox and ratio, or the grain masks a silhouette the plates no
 * longer draw.
 */

const PLATE_OFFSETS = ["translate(2px, 1px)", "translate(-1px, 2px)", "translate(1px, -1px)"];

export function CloudField({ className = "" }: { className?: string }) {
	return (
		<div aria-hidden="true" className={`cloud-field ${className}`.trim()}>
			{CLOUD_PATHS.map((plate, index) => (
				<svg
					key={plate.token}
					aria-hidden="true"
					className="cloud-plate"
					viewBox={CLOUD_VIEWBOX}
					preserveAspectRatio="none"
					style={{ transform: PLATE_OFFSETS[index] }}
				>
					<path d={plate.d} fill={`var(${plate.token})`} />
				</svg>
			))}
		</div>
	);
}
