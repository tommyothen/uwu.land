import { Show } from "@clerk/nextjs";
import Link from "next/link";

export function SiteHeader() {
	return (
		<header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6">
			<Link
				href="/"
				className="font-mono text-lg font-semibold tracking-tight"
			>
				uwu<span className="text-rose-700 dark:text-rose-400">.land</span>
			</Link>
			<nav className="flex items-center gap-5 text-sm">
				<Link
					href="/docs"
					className="text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
				>
					API docs
				</Link>
				<Show when="signed-out">
					<Link
						href="/sign-in"
						className="text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
					>
						Sign in
					</Link>
					<Link
						href="/sign-up"
						className="rounded-lg bg-rose-700 px-3.5 py-1.5 font-medium text-white transition hover:bg-rose-600"
					>
						Sign up
					</Link>
				</Show>
				<Show when="signed-in">
					<Link
						href="/dashboard"
						className="rounded-lg bg-rose-700 px-3.5 py-1.5 font-medium text-white transition hover:bg-rose-600"
					>
						Dashboard
					</Link>
				</Show>
			</nav>
		</header>
	);
}
