import type { CSSProperties } from "react";

/**
 * The state system's rubber stamp (spec §6): text-in-a-box or text-in-a-circle,
 * never illustration. Tone `red` is the postal-red RETURN TO SENDER; `ink` is
 * the neutral MAILBOX FULL / DELIVERED / COPIED postmark. Decorative.
 */
export function RubberStamp({
	lines,
	tone = "red",
	shape = "box",
	rotate = -6,
	pressFrom = 1.4,
	animate = true,
	className = ""
}: {
	lines: string[];
	tone?: "red" | "ink";
	shape?: "box" | "circle";
	rotate?: number;
	pressFrom?: number;
	animate?: boolean;
	className?: string;
}) {
	const color = tone === "red" ? "var(--destructive)" : "var(--foreground)";
	const style = {
		"--stamp-rot": `${rotate}deg`,
		"--press-from": `${pressFrom}`,
		color,
		borderColor: color
	} as CSSProperties;
	return (
		<span
			aria-hidden="true"
			data-animate={animate ? "true" : "false"}
			className={`rubber-stamp rubber-stamp--${shape} ${className}`.trim()}
			style={style}
		>
			{lines.map((line) => (
				<span key={line} className="rubber-stamp-line">
					{line}
				</span>
			))}
		</span>
	);
}
