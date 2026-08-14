import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import App, { Layout } from "./root";

vi.mock("@clerk/react-router", () => ({
	ClerkProvider: ({ children }: { children: ReactNode }) => children
}));

// Stands in for the real shell so the test can see whether the root decided to
// mount Clerk at all, without pulling the SDK in.
vi.mock("./clerk-shell", () => ({
	default: ({ children }: { children: ReactNode }) => (
		<div data-testid="clerk-shell">{children}</div>
	)
}));

const { matches } = vi.hoisted(() => ({ matches: { value: [{ id: "root" }] } }));

vi.mock("react-router", () => ({
	Links: () => null,
	Meta: () => null,
	Outlet: () => <p>route content</p>,
	Scripts: () => null,
	ScrollRestoration: () => null,
	useMatches: () => matches.value
}));

type AppProps = Parameters<typeof App>[0];

function renderApp(hasSession: boolean, routeIds: string[]) {
	matches.value = [{ id: "root" }, ...routeIds.map((id) => ({ id }))];
	return render(
		<App {...({ loaderData: { hasSession } } as AppProps)} />
	);
}

describe("root layout", () => {
	it("renders its children without crashing", () => {
		const { getByText } = render(
			<Layout>
				<p>hello</p>
			</Layout>
		);
		expect(getByText("hello")).toBeInTheDocument();
	});
});

describe("root Clerk gating", () => {
	it("mounts no Clerk provider for an anonymous landing visitor", () => {
		renderApp(false, ["routes/home"]);
		expect(screen.getByText("route content")).toBeInTheDocument();
		expect(screen.queryByTestId("clerk-shell")).toBeNull();
	});

	it("mounts no Clerk provider for anonymous docs and legal pages", () => {
		renderApp(false, ["routes/docs"]);
		expect(screen.queryByTestId("clerk-shell")).toBeNull();
		renderApp(false, ["routes/privacy"]);
		expect(screen.queryByTestId("clerk-shell")).toBeNull();
	});

	it("mounts the Clerk shell on the landing page once a session exists", async () => {
		renderApp(true, ["routes/home"]);
		expect(await screen.findByTestId("clerk-shell")).toBeInTheDocument();
	});

	it("mounts the Clerk shell on auth and dashboard routes when signed out", async () => {
		renderApp(false, ["routes/sign-in/route"]);
		expect(await screen.findByTestId("clerk-shell")).toBeInTheDocument();
	});

	it("mounts the Clerk shell on the dashboard tree", async () => {
		renderApp(false, ["routes/dashboard/layout", "routes/dashboard/index"]);
		expect(await screen.findByTestId("clerk-shell")).toBeInTheDocument();
	});
});
