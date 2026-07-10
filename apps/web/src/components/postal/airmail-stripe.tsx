/**
 * The one edge treatment: an 8px (6px mobile) airmail barber-stripe pinned to
 * the very top edge of the page (spec §5.1). Decorative.
 */
export function AirmailStripe({ className = "" }: { className?: string }) {
	return <div aria-hidden="true" className={`airmail-stripe ${className}`.trim()} />;
}
