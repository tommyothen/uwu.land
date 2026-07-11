import { type CSSProperties, useEffect, useState } from "react";

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

	// Easter egg: an actual postmark. Set after mount so today's date never
	// causes an SSR hydration mismatch. Surfaced as the stamp's hover tooltip.
	const [postmark, setPostmark] = useState<string>();
	useEffect(() => {
		setPostmark(
			new Date()
				.toLocaleDateString(undefined, {
					day: "2-digit",
					month: "short",
					year: "numeric"
				})
				.toUpperCase()
		);
	}, []);

	return (
		<div
			aria-hidden="true"
			className={`stamp ${className}`.trim()}
			style={style}
			title={postmark ? `POSTMARKED ${postmark} · uwu.land` : undefined}
		>
			<span className="stamp-line">AIR MAIL</span>
			<span className="stamp-glyph">✈</span>
			<span className="stamp-line">EST. 2021</span>
		</div>
	);
}
