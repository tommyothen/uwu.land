import { Show } from "@clerk/react-router";
import { Link } from "react-router";
import { ThemeToggle } from "@/components/theme-toggle";

export function SiteHeader() {
	return (
		<>
			<header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6">
				<Link
					to="/"
					className="font-display text-lg font-extrabold tracking-[-0.02em]"
				>
					<span className="uwu-gradient">UwU.</span>Land
				</Link>
				<nav className="flex items-center gap-4 text-sm">
					<Link
						to="/docs"
						className="text-muted-foreground transition hover:text-foreground"
					>
						API docs
					</Link>
					<Show when="signed-out">
						<Link
							to="/sign-in"
							className="text-muted-foreground transition hover:text-foreground"
						>
							Sign in
						</Link>
						<Link
							to="/sign-up"
							className="rounded-[10px] bg-primary px-3.5 py-1.5 font-medium text-primary-foreground transition hover:opacity-90"
						>
							Sign up
						</Link>
					</Show>
					<Show when="signed-in">
						<Link
							to="/dashboard"
							className="rounded-[10px] bg-primary px-3.5 py-1.5 font-medium text-primary-foreground transition hover:opacity-90"
						>
							Dashboard
						</Link>
					</Show>
					<ThemeToggle />
				</nav>
			</header>
			<div aria-hidden="true" className="airmail-hairline" />
		</>
	);
}
