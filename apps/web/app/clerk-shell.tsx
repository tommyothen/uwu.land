import { ClerkProvider, useAuth } from "@clerk/react-router";
import { type ReactNode, useMemo } from "react";
import { ClerkAuthProvider } from "@/lib/session";

// This module is the only place in the app graph that pulls Clerk's client SDK
// at the root. root.tsx loads it through React.lazy so anonymous visitors, who
// need no interactive Clerk, never fetch the chunk.

// Clerk v6's appearance variables map to our shadcn-style CSS tokens. Because
// these resolve as live CSS variables, Clerk's UI follows the `.dark` class
// cascade automatically — no baseTheme swap or re-render on theme toggle. The
// pre-v6 names (colorText, colorInputBackground, …) are silently ignored, which
// is why text and inputs used to render unthemed (dark-on-dark) in dark mode.
const clerkAppearance = {
	variables: {
		colorPrimary: "var(--primary)",
		colorPrimaryForeground: "var(--primary-foreground)",
		colorForeground: "var(--foreground)",
		colorMutedForeground: "var(--muted-foreground)",
		colorBackground: "var(--card)",
		colorMuted: "var(--muted)",
		colorInput: "var(--background)",
		colorInputForeground: "var(--foreground)",
		colorBorder: "var(--border)",
		colorRing: "var(--ring)",
		colorDanger: "var(--destructive)",
		colorShadow: "var(--shadow-ink)",
		borderRadius: "10px"
	}
};

/** Republishes `useAuth()` on a context that carries no Clerk import with it. */
function ClerkAuthBridge({ children }: { children: ReactNode }) {
	const { isLoaded, isSignedIn, getToken } = useAuth();
	const value = useMemo(
		() => ({ isLoaded, isSignedIn: isSignedIn === true, getToken }),
		[isLoaded, isSignedIn, getToken]
	);
	return <ClerkAuthProvider value={value}>{children}</ClerkAuthProvider>;
}

export default function ClerkShell({
	loaderData,
	children
}: {
	loaderData: unknown;
	children: ReactNode;
}) {
	return (
		<ClerkProvider loaderData={loaderData} appearance={clerkAppearance}>
			<ClerkAuthBridge>{children}</ClerkAuthBridge>
		</ClerkProvider>
	);
}
