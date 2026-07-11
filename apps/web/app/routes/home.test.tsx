import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import Home from "./home";

vi.mock("@clerk/react-router", () => ({
	Show: ({ children }: { children: ReactNode }) => children,
	useAuth: () => ({
		isLoaded: true,
		isSignedIn: false,
		getToken: vi.fn(async () => null)
	})
}));

function renderHome() {
	return render(
		<MemoryRouter>
			<Home />
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
		const nav = screen.getByRole("navigation");
		expect(nav.className).toContain("font-sans");
		expect(nav.className).not.toContain("font-mono");
		expect(screen.getByRole("link", { name: "Docs" })).toBeInTheDocument();
	});

	it("marks the decorative stamp aria-hidden", () => {
		renderHome();
		const stampLine = screen.getByText("AIR MAIL");
		expect(stampLine.closest('[aria-hidden="true"]')).not.toBeNull();
	});
});
