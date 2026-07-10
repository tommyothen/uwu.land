/**
 * The uwu.land wordmark, restored from the original design: an extra-bold
 * "UwU." filled with the animated gradient, followed by plain "Land".
 */
export function Wordmark({ className = "" }: { className?: string }) {
	return (
		<h1
			className={`pointer-events-none select-none font-normal leading-none tracking-tight text-gray-800 dark:text-slate-500 ${className}`}
		>
			<span className="uwu-gradient">
				<span className="font-black">UwU</span>.
			</span>
			Land
		</h1>
	);
}
