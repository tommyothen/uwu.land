"use client";

import { useAuth } from "@clerk/react-router";
import type { CreateLinkResponse } from "@uwu/shared";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ClaimTicket } from "@/components/postal/claim-ticket";
import { RubberStamp } from "@/components/postal/rubber-stamp";
import { createLink, UwuApiError } from "@/lib/api";

type Gsap = (typeof import("gsap"))["gsap"];
type GsapContext = ReturnType<Gsap["context"]>;
type GsapTimeline = ReturnType<Gsap["timeline"]>;

/** Beat 4 of §7.2: the result is held until the stamp plane clears (~740ms). */
const PLANE_EXIT_MS = 740;
/** Beats 6-7: the result lands and gets postmarked. */
const LAND_MS = 220;

const COPY = {
	invalid: "That doesn't look like a link. Check the address and try again.",
	server: "Something broke on our end. Not your fault. Give it another go.",
	rateLimited:
		"You've mailed a lot just now. The counter needs a minute, then we'll take the next one.",
	banned: "That destination isn't allowed on uwu.land."
};

type Phase =
	| "idle"
	| "departing"
	| "awaiting"
	| "arriving"
	| "success"
	| "error";

interface PostalError {
	stamp: string;
	tone: "red" | "ink";
	message: string;
	retryAfter: number | null;
}

function isValidUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

function retryAfterFrom(error: UwuApiError): number | null {
	const raw = (error.error as { retry_after?: unknown }).retry_after;
	return typeof raw === "number" && raw > 0 ? Math.floor(raw) : null;
}

function toPostalError(error: unknown): PostalError {
	if (error instanceof UwuApiError) {
		if (error.code === "rate_limited") {
			return {
				stamp: "MAILBOX FULL",
				tone: "ink",
				message: COPY.rateLimited,
				retryAfter: retryAfterFrom(error)
			};
		}
		if (error.code === "invalid_body") {
			return { stamp: "RETURN TO SENDER", tone: "red", message: COPY.invalid, retryAfter: null };
		}
		if (error.code === "url_banned") {
			return { stamp: "RETURN TO SENDER", tone: "red", message: COPY.banned, retryAfter: null };
		}
	}
	return { stamp: "RETURN TO SENDER", tone: "red", message: COPY.server, retryAfter: null };
}

function prefersReducedMotion(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

export function ShortenBox() {
	const [phase, setPhase] = useState<Phase>("idle");
	const [url, setUrl] = useState("");
	const [link, setLink] = useState<CreateLinkResponse | null>(null);
	const [error, setError] = useState<PostalError | null>(null);
	const [torn, setTorn] = useState(false);
	const [countdown, setCountdown] = useState<number | null>(null);
	const [announce, setAnnounce] = useState("");
	const [savedToAccount, setSavedToAccount] = useState(false);

	const { isLoaded, isSignedIn, getToken } = useAuth();

	const scope = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const planeExited = useRef(false);
	const authedRef = useRef(false);
	const apiResult = useRef<
		{ ok: true; link: CreateLinkResponse } | { ok: false; error: unknown } | null
	>(null);
	const planeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const landTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const timeline = useRef<GsapTimeline | null>(null);
	const gsapRef = useRef<Gsap | null>(null);
	const ctxRef = useRef<GsapContext | null>(null);
	const mounted = useRef(true);

	// biome-ignore lint/correctness/useExhaustiveDependencies: run once for lifecycle
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			if (planeTimer.current) clearTimeout(planeTimer.current);
			if (landTimer.current) clearTimeout(landTimer.current);
			timeline.current?.kill();
		};
	}, []);

	useEffect(() => {
		if (import.meta.env.SSR) return;
		let cancelled = false;
		void import("gsap").then((module) => {
			if (cancelled) return;
			gsapRef.current = module.gsap;
			ctxRef.current = module.gsap.context(() => {}, scope);
		});
		return () => {
			cancelled = true;
			ctxRef.current?.revert();
			ctxRef.current = null;
			gsapRef.current = null;
			timeline.current?.kill();
		};
	}, []);

	// Rate-limit countdown, 1Hz, announced politely.
	useEffect(() => {
		if (countdown === null) return;
		if (countdown <= 0) return;
		const id = setInterval(() => {
			setCountdown((current) => (current === null ? null : current - 1));
		}, 1000);
		return () => clearInterval(id);
	}, [countdown]);

	// The send press + the input folding shut behind the departing letter. The
	// plane itself lives in the AIR MAIL stamp (top-right of the page); we fire a
	// window event so it takes off — see the listener in the landing route.
	function takeoff() {
		const gsap = gsapRef.current;
		const ctx = ctxRef.current;
		if (!gsap || !ctx || !scope.current) {
			window.dispatchEvent(new CustomEvent("uwu:send"));
			return;
		}
		ctx.add(() => {
			timeline.current?.kill();
			const tl = gsap.timeline();
			timeline.current = tl;
			const clone = scope.current?.querySelector(".flight-clone");
			const button = scope.current?.querySelector<HTMLElement>(".send-button");

			if (button)
				tl.to(button, { scale: 0.96, duration: 0.09, ease: "power2.out" }, 0).to(
					button,
					{ scale: 1, duration: 0.24, ease: "power2.out" },
					0.09
				);
			if (clone)
				tl.to(
					clone,
					{ scaleX: 0, duration: 0.15, transformOrigin: "right center", ease: "power2.in" },
					0.09
				);
		});
		window.dispatchEvent(new CustomEvent("uwu:send"));
	}

	function landResult() {
		const gsap = gsapRef.current;
		const ctx = ctxRef.current;
		if (!gsap || !ctx || !scope.current) return;
		ctx.add(() => {
			const card = scope.current?.querySelector(".result-card");
			if (card)
				gsap.fromTo(
					card,
					{ y: -16, scale: 1.04, opacity: 0 },
					{ y: 0, scale: 1, opacity: 1, duration: LAND_MS / 1000, ease: "back.out(1.6)" }
				);
		});
	}

	function shake() {
		const gsap = gsapRef.current;
		const ctx = ctxRef.current;
		if (!gsap || !ctx || !scope.current) return;
		ctx.add(() => {
			const card = scope.current?.querySelector(".input-card");
			if (card)
				gsap.fromTo(
					card,
					{ x: -3 },
					{ x: 0, duration: 0.2, ease: "elastic.out(1, 0.3)" }
				);
		});
	}

	function tryProceed(motion: boolean) {
		if (!planeExited.current) return;
		const result = apiResult.current;
		if (result === null) {
			if (motion) setPhase("awaiting");
			return;
		}
		if (result.ok) arrive(result.link, motion);
		else fail(result.error, motion);
	}

	function arrive(created: CreateLinkResponse, motion: boolean) {
		if (!mounted.current) return;
		setSavedToAccount(authedRef.current);
		setLink(created);
		setAnnounce(
			`Your short link is ready: ${created.short_url.replace(/^https?:\/\//, "")}`
		);
		setPhase("arriving");
		if (motion) {
			requestAnimationFrame(landResult);
			landTimer.current = setTimeout(() => {
				if (mounted.current) setPhase("success");
			}, LAND_MS);
		} else {
			setPhase("success");
		}
	}

	function fail(thrown: unknown, motion: boolean) {
		if (!mounted.current) return;
		const postal = toPostalError(thrown);
		setError(postal);
		setCountdown(postal.retryAfter);
		setAnnounce(postal.message);
		setPhase("error");
		if (motion) shake();
		// Return focus to the input once it re-enables, value intact (spec §7.3.1).
		setTimeout(() => {
			if (mounted.current) inputRef.current?.focus({ preventScroll: true });
		}, 0);
	}

	function launch(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (phase !== "idle" && phase !== "error") return;
		const value = url.trim();
		if (value === "") return;

		// Reset transient state.
		timeline.current?.kill();
		if (planeTimer.current) clearTimeout(planeTimer.current);
		if (landTimer.current) clearTimeout(landTimer.current);
		planeExited.current = false;
		apiResult.current = null;
		authedRef.current = false;
		setError(null);
		setCountdown(null);
		setTorn(false);
		setSavedToAccount(false);

		// Invalid URL: the plane never launches (spec §6).
		if (!isValidUrl(value)) {
			fail(new UwuApiError({ status: 400, code: "invalid_body", message: "invalid" }), false);
			return;
		}

		const motion = !prefersReducedMotion();
		setPhase("departing");

		// Signed-in senders file the link under their account; a missing token
		// (unexpected) quietly falls back to an anonymous create.
		const tokenPromise: Promise<string | null> =
			isLoaded && isSignedIn
				? getToken().catch(() => null)
				: Promise.resolve(null);

		tokenPromise
			.then((token) => {
				authedRef.current = token !== null;
				return createLink({ url: value }, token);
			})
			.then((created) => {
				apiResult.current = { ok: true, link: created };
				tryProceed(motion);
			})
			.catch((thrown) => {
				apiResult.current = { ok: false, error: thrown };
				tryProceed(motion);
			});

		if (motion) requestAnimationFrame(takeoff);
		planeTimer.current = setTimeout(
			() => {
				planeExited.current = true;
				tryProceed(motion);
			},
			motion ? PLANE_EXIT_MS : 0
		);
	}

	async function tear() {
		if (!link || torn) return;
		try {
			await navigator.clipboard.writeText(link.short_url);
		} catch {
			// Clipboard can reject on insecure origins; the label still flips.
		}
		setTorn(true);
		setAnnounce("Copied");
	}

	function reset() {
		timeline.current?.kill();
		setUrl("");
		setLink(null);
		setError(null);
		setTorn(false);
		setCountdown(null);
		setAnnounce("");
		setSavedToAccount(false);
		planeExited.current = false;
		apiResult.current = null;
		authedRef.current = false;
		setPhase("idle");
	}

	const showResult = (phase === "arriving" || phase === "success") && link !== null;
	const showForm = !showResult;
	const disabled = phase === "departing" || phase === "awaiting";

	// A couple of quiet postal notes for the curious (spec §9 easter eggs):
	// type "uwu", or try to mail uwu.land to itself.
	const eggNote = (() => {
		const value = url.trim();
		if (value === "") return null;
		if (value.toLowerCase() === "uwu") return "uwu~ not a link, but i felt that.";
		try {
			if (new URL(value).host.replace(/^www\./, "") === "uwu.land")
				return "mailing us to ourselves? bold. 🏤";
		} catch {
			// Not a URL yet — no note.
		}
		return null;
	})();

	return (
		<div ref={scope} className="envelope-shell">
			<span aria-live="polite" className="sr-only">
				{announce}
			</span>

			{showForm && (
				<form onSubmit={launch} noValidate>
					<label htmlFor="shorten-url" className="sr-only">
						URL to shorten
					</label>
					<div className="input-card relative flex items-stretch gap-1.5 rounded-[14px] border-2 border-foreground bg-card p-1.5 shadow-[5px_5px_0_var(--shadow-ink)] focus-within:border-ring">
						<input
							id="shorten-url"
							ref={inputRef}
							type="url"
							required
							disabled={disabled}
							value={url}
							onChange={(event) => setUrl(event.target.value)}
							placeholder="https://verylongsite.com/a/really/long/path"
							className="min-w-0 flex-1 bg-transparent px-3 text-[15px] text-card-foreground outline-none placeholder:text-[color:var(--placeholder)] disabled:opacity-0"
						/>
						<button
							type="submit"
							disabled={disabled}
							className="send-button press shrink-0 rounded-[10px] bg-primary px-5 py-2.5 text-[15px] font-semibold text-primary-foreground shadow-[3px_3px_0_var(--shadow-ink)] disabled:cursor-not-allowed"
						>
							Send it
						</button>

						{disabled && url.trim() !== "" && (
							<span aria-hidden="true" className="flight-clone">
								{url.trim()}
							</span>
						)}

						{error && (
							<RubberStamp
								lines={[error.stamp]}
								tone={error.tone}
								shape="box"
								rotate={-6}
								pressFrom={error.tone === "red" ? 1.4 : 1.2}
								className="state-stamp"
							/>
						)}
					</div>

					{phase === "awaiting" && (
						<p className="mt-3 text-center font-mono text-xs text-muted-foreground">
							in transit…
						</p>
					)}

					{phase === "idle" && eggNote && (
						<p
							aria-hidden="true"
							className="mt-3 text-center font-mono text-xs text-muted-foreground"
						>
							{eggNote}
						</p>
					)}

					{error && (
						<p role="alert" className="mt-3 text-sm font-medium text-destructive">
							{error.message}
							{countdown !== null && countdown > 0 && (
								<span aria-live="polite" className="ml-1 font-mono">
									try again in {countdown}s
								</span>
							)}
						</p>
					)}
				</form>
			)}

			{showResult && link && (
				<div className="result-stack">
					<div className="result-card relative rounded-[14px] border-2 border-foreground bg-card p-5 text-left shadow-[5px_5px_0_var(--shadow-ink)]">
						<RubberStamp
							lines={[torn ? "COPIED" : "DELIVERED"]}
							tone="ink"
							shape="circle"
							rotate={-8}
							pressFrom={torn ? 1.2 : 1.6}
							animate={phase !== "success" || torn}
							className="postmark"
						/>
						<p className="text-[13px] text-muted-foreground">
							{savedToAccount ? (
								<>
									Delivered. Filed under your{" "}
									<Link
										to="/dashboard"
										className="underline underline-offset-2 hover:text-foreground"
									>
										account
									</Link>
									.
								</>
							) : (
								"Delivered. Your link now fits anywhere."
							)}
						</p>
						<p className="mt-1.5 font-mono text-xl font-bold break-all text-card-foreground">
							{link.short_url.replace(/^https?:\/\//, "")}
						</p>
						<button
							type="button"
							onClick={reset}
							className="mt-4 rounded-[10px] border-2 border-foreground px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-secondary"
						>
							Send another
						</button>
					</div>
					<ClaimTicket torn={torn} onTear={tear} />
				</div>
			)}
		</div>
	);
}
