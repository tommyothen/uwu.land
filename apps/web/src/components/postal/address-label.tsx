import { Check, Copy } from "lucide-react";

/** A small adhesive mailing label that keeps the address and copy action together. */
export function AddressLabel({
	url,
	copied,
	onCopy,
	focusable = false
}: {
	url: string;
	copied: boolean;
	onCopy: () => void;
	focusable?: boolean;
}) {
	return (
		<div className={`address-label ${copied ? "address-label--copied" : ""}`.trim()}>
		<p
			tabIndex={focusable ? 0 : undefined}
			className="address-label-url"
		>
			{url.replace(/^https?:\/\//, "")}
		</p>
		<button type="button" onClick={onCopy} className="address-label-copy" aria-label="Copy short link">
			{copied ? (
				<Check size={15} strokeWidth={2.4} aria-hidden="true" />
			) : (
				<Copy size={15} strokeWidth={2.2} aria-hidden="true" />
			)}
			<span>{copied ? "Copied" : "Copy"}</span>
		</button>
		</div>
	);
}
