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
import bricolageWoff2 from "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2";

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
		<html lang="en">
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

const clerkAppearance = {
	variables: {
		colorPrimary: "var(--primary)",
		colorText: "var(--foreground)",
		colorTextSecondary: "var(--muted-foreground)",
		colorBackground: "var(--card)",
		colorInputBackground: "var(--background)",
		colorInputText: "var(--foreground)",
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
