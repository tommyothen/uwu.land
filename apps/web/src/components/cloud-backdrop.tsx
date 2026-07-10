/**
 * The three overlapping wave layers pinned across the bottom of the viewport.
 * The SVG itself lives in app.css (.uwu-clouds), lifted verbatim from the
 * original Layout.astro so the shapes and colours are unchanged.
 */
export function CloudBackdrop() {
	return <div aria-hidden="true" className="uwu-clouds" />;
}
