import { Show } from "@clerk/react-router";
import { Link } from "react-router";
import { CloudBackdrop } from "@/components/cloud-backdrop";
import { GithubCorner } from "@/components/github-corner";
import { ShortenBox } from "@/components/shorten-box";
import { Wordmark } from "@/components/wordmark";

const cornerLink =
	"text-slate-500 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200";

export default function Home() {
	return (
		<div className="relative flex min-h-[100dvh] flex-col overflow-hidden">
			<CloudBackdrop />

			<div className="absolute top-0 right-0 z-10 flex items-center gap-5 p-5 text-sm">
				<Link to="/docs" className={cornerLink}>
					Docs
				</Link>
				<Show when="signed-out">
					<Link to="/sign-in" className={cornerLink}>
						Sign in
					</Link>
				</Show>
				<Show when="signed-in">
					<Link to="/dashboard" className={cornerLink}>
						Dashboard
					</Link>
				</Show>
			</div>

			<main className="flex flex-1 items-center justify-center px-6 pb-40">
				<div className="w-full max-w-xl text-center">
					<Wordmark className="text-6xl sm:text-7xl lg:text-8xl" />
					<div className="mt-10">
						<ShortenBox />
					</div>
					<p className="mx-auto mt-6 max-w-[44ch] text-sm text-slate-500 dark:text-slate-400">
						uwu.land is free forever, and will always be free with no ads or
						account creation required.
					</p>
				</div>
			</main>

			<GithubCorner />
		</div>
	);
}
