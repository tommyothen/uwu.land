import { type RefCallback, useCallback, useEffect, useRef, useState } from "react";

/**
 * Public Turnstile site key. Production builds use the real widget, which only
 * serves uwu.land and app.uwu.land; dev and tests fall back to Cloudflare's
 * always-pass test key. VITE_TURNSTILE_SITE_KEY overrides either.
 */
const SITE_KEY: string =
	import.meta.env.VITE_TURNSTILE_SITE_KEY ||
	(import.meta.env.PROD
		? "0x4AAAAAAGIlX67F7ID-d8-W"
		: "1x00000000000000000000AA");

const SCRIPT_URL =
	"https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** The slice of Cloudflare's `window.turnstile` API this app uses. */
interface TurnstileApi {
	render(
		container: HTMLElement,
		options: {
			sitekey: string;
			appearance: "interaction-only";
			size: "flexible";
			theme: "light" | "dark";
			"response-field": false;
			callback: (token: string) => void;
			"expired-callback": () => void;
			"error-callback": () => void;
			"before-interactive-callback": () => void;
			"after-interactive-callback": () => void;
		}
	): string | undefined;
	reset(widgetId: string): void;
	remove(widgetId: string): void;
}

declare global {
	interface Window {
		turnstile?: TurnstileApi;
	}
}

let pending: Promise<TurnstileApi> | null = null;

/** Injects Cloudflare's script once per page; a failed load can be retried. */
function loadTurnstile(): Promise<TurnstileApi> {
	pending ??= new Promise<TurnstileApi>((resolve, reject) => {
		const script = document.createElement("script");
		script.src = SCRIPT_URL;
		script.async = true;
		const fail = (message: string) => {
			pending = null;
			script.remove();
			reject(new Error(message));
		};
		script.onload = () => {
			if (window.turnstile) resolve(window.turnstile);
			else fail("Turnstile loaded without its API");
		};
		script.onerror = () => fail("Turnstile failed to load");
		document.head.appendChild(script);
	});
	return pending;
}

/** The next token the widget will hand over, settled at most once. */
interface TokenSlot {
	promise: Promise<string>;
	settled: boolean;
	resolve: (token: string) => void;
	reject: (error: Error) => void;
}

function createSlot(): TokenSlot {
	let settle!: { resolve: (token: string) => void; reject: (error: Error) => void };
	const promise = new Promise<string>((resolve, reject) => {
		settle = { resolve, reject };
	});
	// Nobody may be waiting yet; a failure only matters once a send asks.
	promise.catch(() => {});
	const slot: TokenSlot = {
		promise,
		settled: false,
		resolve: (token) => {
			slot.settled = true;
			settle.resolve(token);
		},
		reject: (error) => {
			slot.settled = true;
			settle.reject(error);
		}
	};
	return slot;
}

export interface Turnstile {
	/**
	 * Callback ref for where the widget renders. Empty unless Cloudflare wants a
	 * click. A new container (the form remounting) gets a fresh widget.
	 */
	containerRef: RefCallback<HTMLDivElement>;
	/** True while the widget is showing an interactive challenge. */
	interactive: boolean;
	/**
	 * Resolves with a single-use token, waiting for the challenge if it is
	 * still running, then queues a fresh challenge for the next send. Rejects
	 * when the widget failed or is not active.
	 */
	takeToken: () => Promise<string>;
}

/**
 * Renders a Managed-mode Turnstile widget while `enabled`, loading Cloudflare's
 * script only then, so pages and visitors that never need a check never fetch it.
 */
export function useTurnstile(enabled: boolean): Turnstile {
	const [container, containerRef] = useState<HTMLDivElement | null>(null);
	// Bumped to retry after the script failed to load.
	const [loadAttempt, setLoadAttempt] = useState(0);
	const slot = useRef<TokenSlot>(createSlot());
	const widget = useRef<{ api: TurnstileApi; id: string } | null>(null);
	const [interactive, setInteractive] = useState(false);

	// biome-ignore lint/correctness/useExhaustiveDependencies: loadAttempt is the retry trigger, so it must rerun the effect
	useEffect(() => {
		if (!enabled || container === null) return;
		let cancelled = false;
		loadTurnstile().then(
			(api) => {
				if (cancelled) return;
				const id = api.render(container, {
					sitekey: SITE_KEY,
					appearance: "interaction-only",
					size: "flexible",
					theme: document.documentElement.classList.contains("dark")
						? "dark"
						: "light",
					"response-field": false,
					callback: (token) => slot.current.resolve(token),
					"expired-callback": () => {
						if (slot.current.settled) slot.current = createSlot();
					},
					"error-callback": () =>
						slot.current.reject(new Error("Turnstile challenge failed")),
					"before-interactive-callback": () => setInteractive(true),
					"after-interactive-callback": () => setInteractive(false)
				});
				if (id !== undefined) widget.current = { api, id };
			},
			(error: Error) => {
				if (!cancelled) slot.current.reject(error);
			}
		);
		return () => {
			cancelled = true;
			if (widget.current) widget.current.api.remove(widget.current.id);
			widget.current = null;
			setInteractive(false);
		};
	}, [enabled, container, loadAttempt]);

	const enabledRef = useRef(enabled);
	enabledRef.current = enabled;

	const takeToken = useCallback((): Promise<string> => {
		if (!enabledRef.current) {
			return Promise.reject(new Error("Turnstile is not active"));
		}
		const current = slot.current;
		// A rendered widget gets reset for a fresh challenge. Without one (the
		// script failed to load), load it again so the next send can succeed.
		const renew = () => {
			if (slot.current !== current) return;
			slot.current = createSlot();
			if (widget.current) widget.current.api.reset(widget.current.id);
			else setLoadAttempt((attempt) => attempt + 1);
		};
		return current.promise.then(
			(token) => {
				renew();
				return token;
			},
			(error: unknown) => {
				renew();
				throw error;
			}
		);
	}, []);

	return { containerRef, interactive, takeToken };
}
