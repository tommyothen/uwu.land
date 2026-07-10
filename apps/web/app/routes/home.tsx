import { Link } from "react-router";
import { ShortenBox } from "@/components/shorten-box";
import { SiteHeader } from "@/components/site-header";

const CAPABILITIES = [
	{
		title: "Free for everyone, always",
		body: "Paste a link, get a short one. No account, no ads, no tracking wall. The anonymous lane is the product, not a trial."
	},
	{
		title: "Accounts add management",
		body: "Sign up to pick custom slugs, see click counts, and list or delete your links from the dashboard.",
		link: { href: "/sign-up", label: "Sign up" }
	},
	{
		title: "An API for integrations",
		body: "Create an API key and shorten links from your own apps and bots. The dashboard runs on the same public API you get.",
		link: { href: "/docs", label: "Read the API docs" }
	}
];

export default function Home() {
	return (
		<div className="flex min-h-[100dvh] flex-col">
			<SiteHeader />
			<main className="mx-auto w-full max-w-5xl flex-1 px-6">
				<section className="grid items-center gap-10 py-16 md:py-24 lg:grid-cols-2">
					<div>
						<h1 className="text-4xl font-semibold tracking-tighter md:text-5xl">
							Long links, made tiny.
						</h1>
						<p className="mt-5 max-w-[42ch] text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
							uwu.land is free forever, and will always be free with no ads or
							account creation required.
						</p>
					</div>
					<ShortenBox />
				</section>

				<section className="border-t border-zinc-200 py-14 dark:border-zinc-800">
					<div className="grid gap-10 md:grid-cols-[1.4fr_1fr] md:gap-14">
						<div>
							<h2 className="text-2xl font-semibold tracking-tight">
								{CAPABILITIES[0]?.title}
							</h2>
							<p className="mt-3 max-w-[52ch] leading-relaxed text-zinc-600 dark:text-zinc-400">
								{CAPABILITIES[0]?.body}
							</p>
						</div>
						<div className="grid gap-8">
							{CAPABILITIES.slice(1).map((cap) => (
								<div key={cap.title}>
									<h2 className="text-base font-semibold">{cap.title}</h2>
									<p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
										{cap.body}
									</p>
									{cap.link && (
										<Link
								to={cap.link.href}
											className="mt-3 inline-block text-sm font-medium text-rose-700 transition hover:text-rose-600 dark:text-rose-400"
										>
											{cap.link.label}
										</Link>
									)}
								</div>
							))}
						</div>
					</div>
				</section>
			</main>
			<footer className="border-t border-zinc-200 dark:border-zinc-800">
				<div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6 text-sm text-zinc-500 dark:text-zinc-400">
					<p>MIT licensed.</p>
					<div className="flex gap-5">
						<Link
							to="/docs"
							className="transition hover:text-zinc-900 dark:hover:text-zinc-100"
						>
							API docs
						</Link>
						<a
							href="https://github.com/tommyothen/uwu.land"
							className="transition hover:text-zinc-900 dark:hover:text-zinc-100"
						>
							GitHub
						</a>
					</div>
				</div>
			</footer>
		</div>
	);
}
