/**
 * The envelope's return address, top-left (spec §5.1): Space Mono, two lines.
 * Persists across the landing and the 404 as the envelope frame.
 */
export function ReturnAddress({ className = "" }: { className?: string }) {
	return (
		<div className={`return-address ${className}`.trim()}>
			<span className="return-address-line">from: uwu.land</span>
			<span className="return-address-line">the tiny link post office</span>
		</div>
	);
}
