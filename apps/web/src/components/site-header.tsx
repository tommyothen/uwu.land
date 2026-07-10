import { Show } from "@clerk/react-router";
import { Link } from "react-router";

export function SiteHeader() {
	return (
		<header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6">
			<Link
				to="/"
				className="font-mono text-lg font-semibold tracking-tight"
			>
				uwu<span className="uwu-gradient">.land</span>
			</Link>
			<nav className="flex items-center gap-5 text-sm">
				<Link
					to="/docs"
					className="text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
				>
					API docs
				</Link>
				<Show when="signed-out">
					<Link
						to="/sign-in"
						className="text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
					>
						Sign in
					</Link>
					<Link
						to="/sign-up"
						className="rounded-lg bg-indigo-600 px-3.5 py-1.5 font-medium text-white transition hover:bg-indigo-500"
					>
						Sign up
					</Link>
				</Show>
				<Show when="signed-in">
					<Link
						to="/dashboard"
						className="rounded-lg bg-indigo-600 px-3.5 py-1.5 font-medium text-white transition hover:bg-indigo-500"
					>
						Dashboard
					</Link>
				</Show>
			</nav>
		</header>
	);
}
