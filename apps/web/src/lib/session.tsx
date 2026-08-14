import { createContext, useContext } from "react";

/**
 * Auth state that costs no client JavaScript. The root loader runs behind
 * `clerkMiddleware()`, so whether a session exists is known server-side on the
 * very first render and can be threaded down as a plain boolean. Anything that
 * only needs "signed in or not" must read this instead of Clerk's `<Show>` or
 * `useAuth()`, because the Clerk provider is deliberately absent for anonymous
 * visitors.
 */
const HasSessionContext = createContext(false);

export const HasSessionProvider = HasSessionContext.Provider;

export function useHasSession(): boolean {
	return useContext(HasSessionContext);
}

/** The slice of Clerk's `useAuth()` that link creation needs. */
export interface ClerkAuth {
	isLoaded: boolean;
	isSignedIn: boolean;
	getToken: () => Promise<string | null>;
}

/**
 * Published by the Clerk shell from inside `<ClerkProvider>`. Null means the
 * provider is not mounted, which happens only when the root loader saw no
 * session, so a null here can never strand a signed-in user without a token.
 */
const ClerkAuthContext = createContext<ClerkAuth | null>(null);

export const ClerkAuthProvider = ClerkAuthContext.Provider;

export function useClerkAuth(): ClerkAuth | null {
	return useContext(ClerkAuthContext);
}
