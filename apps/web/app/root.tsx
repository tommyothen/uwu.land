import { ClerkProvider } from "@clerk/react-router";
import { clerkMiddleware, rootAuthLoader } from "@clerk/react-router/server";
import type { ReactNode } from "react";
import {
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration
} from "react-router";
import type { Route } from "./+types/root";
import stylesheet from "./app.css?url";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/instrument-sans";
import "@fontsource/space-mono";
import bricolageWoff2 from "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2?url";

const themeBootstrap = `(() => { try { const stored = localStorage.getItem("uwu-theme"); const theme = stored === "dark" || stored === "light" ? stored : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); document.documentElement.classList.toggle("dark", theme === "dark"); } catch {} })();`;

export const middleware: Route.MiddlewareFunction[] = [clerkMiddleware()];
export const loader = (args: Route.LoaderArgs) => rootAuthLoader(args);

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

export default function App({ loaderData }: Route.ComponentProps) {
	return (
		<ClerkProvider loaderData={loaderData} appearance={clerkAppearance}>
			<Outlet />
		</ClerkProvider>
	);
}
