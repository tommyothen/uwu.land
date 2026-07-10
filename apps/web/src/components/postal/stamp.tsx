import type { CSSProperties } from "react";

/**
 * The one postal object on the landing: a dashed circular AIR MAIL stamp,
 * rotated 9°, text-in-a-circle (never illustration). Decorative (aria-hidden);
 * sizing is driven by the `--stamp-size` custom property so the landing can set
 * it responsively (100/84/64 per spec §5 breakpoints) while tests can pin it via
 * the `size` prop.
 */
export function Stamp({
	size,
	className = ""
}: {
	size?: number;
	className?: string;
}) {
	const style =
		size === undefined
			? undefined
			: ({ "--stamp-size": `${size}px` } as CSSProperties);
	return (
		<div aria-hidden="true" className={`stamp ${className}`.trim()} style={style}>
			<span className="stamp-line">AIR MAIL</span>
			<span className="stamp-glyph">✈</span>
			<span className="stamp-line">EST. 2021</span>
		</div>
	);
}
