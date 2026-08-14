import {
	clerkMiddleware,
	getAuth,
	rootAuthLoader
} from "@clerk/react-router/server";
import { lazy, type ReactNode, Suspense } from "react";
import {
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	useMatches
} from "react-router";
import { HasSessionProvider } from "@/lib/session";
import type { Route } from "./+types/root";
import stylesheet from "./app.css?url";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/instrument-sans";
import "@fontsource/space-mono";
import bricolageWoff2 from "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2?url";

const themeBootstrap = `(() => { try { const stored = localStorage.getItem("uwu-theme"); const theme = stored === "dark" || stored === "light" ? stored : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); document.documentElement.classList.toggle("dark", theme === "dark"); } catch {} })();`;

export const middleware: Route.MiddlewareFunction[] = [clerkMiddleware()];

// The full Clerk session state still ships in the loader payload (rootAuthLoader
// spreads it over whatever the callback returns); `hasSession` is the one field
// the app reads without the client SDK.
export const loader = (args: Route.LoaderArgs) =>
	rootAuthLoader(args, async (authArgs) => {
		const { userId } = await getAuth(authArgs);
		return { hasSession: userId !== null };
	});

// Routes whose UI is Clerk's own (sign-in, sign-up, the dashboard shell and the
// dev preview of the account panel). They need the provider even when the
// visitor is signed out, so they are matched by route id rather than by session.
const CLERK_ROUTE_PREFIXES = [
	"routes/sign-in",
	"routes/sign-up",
	"routes/dashboard",
	"routes/dev-account-preview"
];

const ClerkShell = lazy(() => import("./clerk-shell"));

export const links: Route.LinksFunction = () => [
	{ rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
	{
		rel: "preload",
		href: bricolageWoff2,
		as: "font",
		type: "font/woff2",
		crossOrigin: "anonymous"
	},
	{ rel: "stylesheet", href: stylesheet }
];

export const meta: Route.MetaFunction = () => [
	{ title: "uwu.land" },
	{
		name: "description",
		content:
			"uwu.land is a fast, free URL shortener with an open API. Free forever, no ads, no account required."
	}
];

export function Layout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<Meta />
				<Links />
				<script>{themeBootstrap}</script>
			</head>
			<body className="antialiased">
				{children}
				<div aria-hidden="true" className="grain-layer" />
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

export default function App({ loaderData }: Route.ComponentProps) {
	const hasSession = loaderData?.hasSession === true;
	const matches = useMatches();
	const needsClerk =
		hasSession ||
		matches.some((match) =>
			CLERK_ROUTE_PREFIXES.some((prefix) => match.id.startsWith(prefix))
		);

	// Anonymous visitors to the landing page, the docs and the legal pages get no
	// provider, so none of Clerk's client JavaScript enters their graph. Signed-in
	// visitors get the shell around the whole tree: the route content sits inside
	// the lazy boundary, so nothing under it is interactive (and no link can be
	// created) until the provider and its token accessor are mounted.
	if (!needsClerk) {
		return (
			<HasSessionProvider value={false}>
				<Outlet />
			</HasSessionProvider>
		);
	}

	return (
		<HasSessionProvider value={hasSession}>
			<Suspense fallback={null}>
				<ClerkShell loaderData={loaderData}>
					<Outlet />
				</ClerkShell>
			</Suspense>
		</HasSessionProvider>
	);
}
