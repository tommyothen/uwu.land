type Gsap = (typeof import("gsap"))["gsap"];

let pending: Promise<Gsap | null> | null = null;
let loaded: Gsap | null = null;

export function prefersReducedMotion(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

/**
 * Fetches gsap once, shared by every animated surface on the page. Reduced-motion
 * visitors and the server must never pay for the bundle, so those cases resolve
 * null without importing and without caching the refusal. Call this from a user
 * interaction, not from mount.
 */
export function loadGsap(): Promise<Gsap | null> {
	if (import.meta.env.SSR || prefersReducedMotion()) return Promise.resolve(null);
	pending ??= import("gsap")
		.then((module) => {
			loaded = module.gsap;
			return loaded;
		})
		.catch(() => null);
	return pending;
}

/** Synchronous peek for animation entry points that cannot await. */
export function getGsap(): Gsap | null {
	return loaded;
}
