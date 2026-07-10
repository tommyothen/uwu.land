import { Show } from "@clerk/react-router";
import { Link } from "react-router";
import { AirmailStripe } from "@/components/postal/airmail-stripe";
import { CloudField } from "@/components/postal/cloud-field";
import { GithubMark } from "@/components/postal/github-mark";
import { ReturnAddress } from "@/components/postal/return-address";
import { Stamp } from "@/components/postal/stamp";
import { ShortenBox } from "@/components/shorten-box";
import { Wordmark } from "@/components/wordmark";

const navLink =
	"text-foreground/75 transition hover:text-foreground hover:underline";

export default function Home() {
	return (
		<div className="landing-root relative flex min-h-[100dvh] flex-col overflow-hidden">
			<AirmailStripe />

			<div
				className="enter-fade absolute top-4 left-5 z-[4] sm:top-7 sm:left-[34px]"
				style={{ animationDelay: "230ms" }}
			>
				<ReturnAddress />
			</div>

			<nav
				className="enter-fade absolute top-4 right-5 z-[4] flex items-center gap-3 font-sans text-[13px] font-semibold sm:top-7 sm:right-[34px]"
				style={{ animationDelay: "230ms" }}
			>
				<Link to="/docs" className={navLink}>
					Docs
				</Link>
				<span aria-hidden="true" className="text-foreground/40">
					·
				</span>
				<Show when="signed-out">
					<Link to="/sign-in" className={navLink}>
						Sign in
					</Link>
				</Show>
				<Show when="signed-in">
					<Link to="/dashboard" className={navLink}>
						Dashboard
					</Link>
				</Show>
			</nav>

			<div
				className="landing-stamp enter-stamp"
				style={{ animationDelay: "300ms" }}
			>
				<Stamp />
			</div>

			<main className="relative z-[4] flex flex-1 items-center justify-center px-6">
				<div className="w-full max-w-[560px] text-center">
					<Wordmark
						className="enter text-[clamp(3.5rem,5vw+1.5rem,5.5rem)]"
						style={{ animationDelay: "60ms" }}
					/>
					<p
						className="enter mt-4 text-[17px] font-medium text-muted-foreground"
						style={{ animationDelay: "120ms" }}
					>
						Long links in. Short links out. That's the whole thing.
					</p>
					<div className="enter mt-9" style={{ animationDelay: "170ms" }}>
						<ShortenBox />
					</div>
				</div>
			</main>

			<p
				className="enter-fade absolute right-0 left-0 z-[4] px-6 text-center font-mono text-[11px] tracking-[0.04em] text-foreground sm:text-xs"
				style={{
					bottom: "calc(var(--field-h) + 20px)",
					animationDelay: "230ms"
				}}
			>
				uwu.land is free forever, and will always be free with no ads or account
				creation required.
			</p>

			<CloudField className="enter-field" />

			<GithubMark className="absolute right-4 bottom-4 z-[2]" />
		</div>
	);
}
