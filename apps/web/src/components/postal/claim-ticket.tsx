/**
 * The claim ticket (spec §6): a stub hanging below the result card on a dashed
 * perforation. It is a real button (accessible name "Copy short link"); its
 * visible label reads `tear + copy`, then `copied!` once torn. The tear shift is
 * a CSS class applied on click.
 */
export function ClaimTicket({
	torn,
	onTear
}: {
	torn: boolean;
	onTear: () => void;
}) {
	return (
		<div className="claim-ticket-wrap">
			<button
				type="button"
				onClick={onTear}
				aria-label="Copy short link"
				className={`claim-ticket ${torn ? "claim-ticket--torn" : ""}`.trim()}
			>
				{torn ? "copied!" : "tear + copy"}
			</button>
		</div>
	);
}
