import { ShortenBox } from "@/components/shorten-box";
import { SiteHeader } from "@/components/site-header";

export default function ShortLinkNotFound() {
	return (
		<div className="flex min-h-[100dvh] flex-col">
			<SiteHeader />
			<main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16 md:py-24">
				<h1 className="text-3xl font-semibold tracking-tighter md:text-4xl">
					That short link doesn't exist.
				</h1>
				<p className="mt-4 text-zinc-600 dark:text-zinc-400">
					It may have been deleted, or the address was mistyped. Want to make
					one that does?
				</p>
				<div className="mt-8">
					<ShortenBox />
				</div>
			</main>
		</div>
	);
}
