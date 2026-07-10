/**
 * The uwu.land wordmark (spec §2): "UwU." in Bricolage 800 with the one static
 * gradient fill, "Land" in Bricolage 500 ink. One line, tracking -0.02em.
 */
export function Wordmark({
	className = "",
	style
}: {
	className?: string;
	style?: React.CSSProperties;
}) {
	return (
		<h1
			style={style}
			className={`pointer-events-none font-display leading-none tracking-[-0.02em] text-foreground select-none ${className}`.trim()}
		>
			<span className="uwu-gradient font-extrabold">UwU.</span>
			<span className="font-medium">Land</span>
		</h1>
	);
}
