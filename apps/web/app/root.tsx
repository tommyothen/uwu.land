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

export const middleware: Route.MiddlewareFunction[] = [clerkMiddleware()];
export const loader = (args: Route.LoaderArgs) => rootAuthLoader(args);

export const links: Route.LinksFunction = () => [
	{ rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
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
			</head>
			<body className="antialiased">
				{children}
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

export default function App({ loaderData }: Route.ComponentProps) {
	return (
		<ClerkProvider loaderData={loaderData}>
			<Outlet />
		</ClerkProvider>
	);
}
