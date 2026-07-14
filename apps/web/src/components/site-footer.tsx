import { Link } from "react-router";

const footerLink = "text-muted-foreground transition hover:text-foreground";

/**
 * Site-wide footer for the content pages (docs, legal). Sticks to the bottom of
 * a `min-h-[100dvh] flex-col` shell via `mt-auto`. The landing page has its own
 * cloud-field footer and links to these pages from its own band instead.
 */
export function SiteFooter() {
	return (
		<footer className="mt-auto">
			<div aria-hidden="true" className="airmail-hairline" />
			<div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-8 text-sm sm:flex-row sm:items-center sm:justify-between">
				<nav className="flex flex-wrap items-center gap-x-4 gap-y-2">
					<Link to="/docs" className={footerLink}>
						API docs
					</Link>
					<Link to="/privacy" className={footerLink}>
						Privacy
					</Link>
					<Link to="/terms" className={footerLink}>
						Terms
					</Link>
					<Link to="/acceptable-use" className={footerLink}>
						Acceptable use
					</Link>
					<Link to="/refunds" className={footerLink}>
						Refunds
					</Link>
					<a
						href="https://github.com/tommyothen/uwu.land"
						target="_blank"
						rel="noreferrer"
						className={footerLink}
					>
						GitHub
					</a>
				</nav>
				<p className="text-muted-foreground">
					Free forever. No ads. No account required.
				</p>
			</div>
		</footer>
	);
}
