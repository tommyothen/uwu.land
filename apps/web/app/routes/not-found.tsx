import { Link } from "react-router";
import { CloudField } from "@/components/postal/cloud-field";
import { ShortenBox } from "@/components/shorten-box";
import { Wordmark } from "@/components/wordmark";

export default function ShortLinkNotFound() {
	return (
		<div className="landing-root relative flex min-h-[100dvh] flex-col overflow-hidden">
			<div className="absolute top-0 right-0 z-[4] p-5 text-sm">
				<Link to="/" className="text-foreground/75 transition hover:text-foreground">
					Home
				</Link>
			</div>

			<main className="relative z-[4] flex flex-1 items-center justify-center px-6 pb-40">
				<div className="w-full max-w-xl text-center">
					<Wordmark className="text-5xl sm:text-6xl lg:text-7xl" />
					<h2 className="mt-8 text-xl font-semibold text-foreground">
						That link doesn't exist.
					</h2>
					<p className="mx-auto mt-2 max-w-[42ch] text-sm text-muted-foreground">
						It may have been deleted, or the address was mistyped. Want to make
						one that does?
					</p>
					<div className="mt-8">
						<ShortenBox />
					</div>
				</div>
			</main>

			<CloudField />
		</div>
	);
}
