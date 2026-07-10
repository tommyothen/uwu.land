import { Link } from "react-router";
import { CloudBackdrop } from "@/components/cloud-backdrop";
import { GithubCorner } from "@/components/github-corner";
import { ShortenBox } from "@/components/shorten-box";
import { Wordmark } from "@/components/wordmark";

export default function ShortLinkNotFound() {
	return (
		<div className="relative flex min-h-[100dvh] flex-col overflow-hidden">
			<CloudBackdrop />

			<div className="absolute top-0 right-0 z-10 p-5 text-sm">
				<Link
					to="/"
					className="text-slate-500 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
				>
					Home
				</Link>
			</div>

			<main className="flex flex-1 items-center justify-center px-6 pb-40">
				<div className="w-full max-w-xl text-center">
					<Wordmark className="text-5xl sm:text-6xl lg:text-7xl" />
					<h2 className="mt-8 text-xl font-semibold text-slate-800 dark:text-slate-200">
						That link doesn't exist.
					</h2>
					<p className="mx-auto mt-2 max-w-[42ch] text-sm text-slate-500 dark:text-slate-400">
						It may have been deleted, or the address was mistyped. Want to make
						one that does?
					</p>
					<div className="mt-8">
						<ShortenBox />
					</div>
				</div>
			</main>

			<GithubCorner />
		</div>
	);
}
