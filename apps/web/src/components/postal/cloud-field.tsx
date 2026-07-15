import { CLOUD_PATHS, CLOUD_VIEWBOX } from "@/lib/cloud-paths";

/**
 * The riso cloud field: the three v1 wave contours reprinted as flat risograph
 * plates, stacked back-to-front (cloud-1 under cloud-2 under cloud-3). Each
 * plate carries a small registration offset and multiplies over the lavender
 * paper (light mode), the way overlapping riso passes never line up perfectly.
 * Grain concentrates here via the `.cloud-field::after` ink layer (spec §3).
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
					preserveAspectRatio="xMidYMax slice"
					style={{ transform: PLATE_OFFSETS[index] }}
				>
					<path d={plate.d} fill={`var(${plate.token})`} />
				</svg>
			))}
		</div>
	);
}
