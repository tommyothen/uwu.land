import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { loadGsap } from "@/lib/motion";
import { HasSessionProvider } from "@/lib/session";
import Home from "./home";

vi.mock("@/lib/motion", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/motion")>();
	return { ...actual, loadGsap: vi.fn(async () => null) };
});

// The landing page must download no Clerk client code. This factory only runs if
// something in the render graph actually imports the SDK, so every test below
// that renders without throwing is an assertion that it does not.
vi.mock("@clerk/react-router", () => {
	throw new Error("the landing page must not import Clerk's client SDK");
});

function renderHome(hasSession = false) {
	return render(
		<MemoryRouter>
			<HasSessionProvider value={hasSession}>
				<Home />
			</HasSessionProvider>
		</MemoryRouter>
	);
}

describe("landing page", () => {
	it("states the founding promise verbatim", () => {
		renderHome();
		expect(
			screen.getByText(
				"uwu.land is free forever, and will always be free with no ads or account creation required."
			)
		).toBeInTheDocument();
	});

	it("renders the promise on the paper, never on the cloud field", () => {
		renderHome();
		const promise = screen.getByText(/free forever/);
		expect(promise.closest(".cloud-field")).toBeNull();
	});

	it("labels the submit button 'Send it' with no plane glyph", () => {
		renderHome();
		const button = screen.getByRole("button", { name: "Send it" });
		expect(button).toBeInTheDocument();
		expect(button.querySelector("svg")).toBeNull();
	});

	it("keeps the nav in the sans face, not mono", () => {
		renderHome();
		const nav = screen.getByRole("navigation", { name: "Primary" });
		expect(nav.className).toContain("font-sans");
		expect(nav.className).not.toContain("font-mono");
		expect(screen.getByRole("link", { name: "Docs" })).toBeInTheDocument();
	});

	it("fetches no animation bundle on mount", () => {
		renderHome();
		expect(vi.mocked(loadGsap)).not.toHaveBeenCalled();
	});

	it("marks the decorative stamp aria-hidden", () => {
		renderHome();
		const stampLine = screen.getByText("AIR MAIL");
		expect(stampLine.closest('[aria-hidden="true"]')).not.toBeNull();
	});

	it("offers sign-in to anonymous visitors and never mounts Clerk", () => {
		renderHome();
		expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
		expect(screen.queryByRole("link", { name: "Dashboard" })).toBeNull();
	});

	it("swaps the nav for the dashboard when the root loader saw a session", () => {
		renderHome(true);
		expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
		expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
	});
});
