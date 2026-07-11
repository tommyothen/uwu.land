import { Show } from "@clerk/react-router";
import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { AirmailStripe } from "@/components/postal/airmail-stripe";
import { CloudField } from "@/components/postal/cloud-field";
import { GithubMark } from "@/components/postal/github-mark";
import { ReturnAddress } from "@/components/postal/return-address";
import { Stamp } from "@/components/postal/stamp";
import { ShortenBox } from "@/components/shorten-box";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";

const navLink =
	"text-foreground/75 transition hover:text-foreground hover:underline";

type GsapTimeline = ReturnType<(typeof import("gsap"))["gsap"]["timeline"]>;

/** A postcard slipped into the console for anyone who opens dev tools. */
function franks() {
	const today = new Date().toLocaleDateString(undefined, {
		day: "2-digit",
		month: "short",
		year: "numeric"
	});
	console.log(
		"%c ✉ uwu.land %c the tiny link post office ",
		"background:#4f39fa;color:#fff;font-weight:700;border-radius:4px 0 0 4px;padding:3px 6px;font-family:monospace",
		"background:#da62c4;color:#fff;border-radius:0 4px 4px 0;padding:3px 6px;font-family:monospace"
	);
	console.log(
		`%cpostmarked ${today}. built in the open. pull up a chair: github.com/tommyothen/uwu.land`,
		"color:#9176e0;font-family:monospace;font-size:11px"
	);
}

function prefersReducedMotion(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

export default function Home() {
	const flight = useRef<GsapTimeline | null>(null);

	useEffect(() => {
		franks();
	}, []);

	// The AIR MAIL stamp's plane takes off on send: it darts out past the right
	// edge, then fades back in from the left and settles into the stamp. Wired via
	// a window event the ShortenBox fires when it launches (motion only). The
	// landing root is overflow-hidden, so the off-screen travel adds no scrollbars.
	useEffect(() => {
		if (import.meta.env.SSR) return;
		let cancelled = false;
		let gsap: (typeof import("gsap"))["gsap"] | null = null;
		void import("gsap").then((module) => {
			if (!cancelled) gsap = module.gsap;
		});

		function onSend() {
			const gsapInstance = gsap;
			if (prefersReducedMotion() || !gsapInstance) return;
			const glyph = document.querySelector<HTMLElement>(
				".landing-stamp .stamp-glyph"
			);
			if (!glyph) return;

			const rect = glyph.getBoundingClientRect();
			const vw = window.innerWidth;
			// Travel far enough to fully clear both edges from the glyph's home spot.
			const exitX = vw - rect.left + 48;
			const enterX = -(rect.right + 48);

			flight.current?.kill();
			flight.current = gsapInstance
				.timeline({ onComplete: () => gsapInstance.set(glyph, { clearProps: "all" }) })
				.set(glyph, { transformOrigin: "50% 50%" })
				.to(glyph, {
					x: exitX,
					y: -20,
					rotation: 14,
					scale: 1.05,
					opacity: 0,
					duration: 0.5,
					ease: "power2.in"
				})
				.set(glyph, { x: enterX, y: 16, rotation: -10, scale: 0.9 })
				.to(glyph, {
					x: 0,
					y: 0,
					rotation: 0,
					scale: 1,
					opacity: 1,
					duration: 0.72,
					ease: "back.out(1.3)"
				});
		}

		window.addEventListener("uwu:send", onSend);
		return () => {
			cancelled = true;
			window.removeEventListener("uwu:send", onSend);
			flight.current?.kill();
		};
	}, []);

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
				className="enter-fade absolute top-4 right-5 z-[5] flex items-center gap-3 font-sans text-[13px] font-semibold sm:top-7 sm:right-[34px]"
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
				<span aria-hidden="true" className="text-foreground/40">
					·
				</span>
				<ThemeToggle variant="bare" />
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
						Long links in. Short links out.
					</p>
					<div className="enter mt-9" style={{ animationDelay: "170ms" }}>
						<ShortenBox />
					</div>
				</div>
			</main>

			{/* The founding promise sits in flow as a footer band, its padding
			    reserving the cloud-field height below it. Because it is a flex
			    sibling of <main> (not absolutely positioned), it can never collide
			    with the result card's claim-ticket stub in any state or width. */}
			<footer
				className="enter-fade pointer-events-none relative z-[4] px-6 pt-4 text-center"
				style={{
					paddingBottom: "calc(var(--field-h) + 12px)",
					animationDelay: "230ms"
				}}
			>
				<p className="mx-auto max-w-[52ch] font-mono text-[11px] tracking-[0.04em] text-foreground sm:text-xs">
					uwu.land is free forever, and will always be free with no ads or
					account creation required.
				</p>
			</footer>

			<CloudField className="enter-field" />

			<GithubMark className="absolute right-4 bottom-4 z-[2]" />
		</div>
	);
}
