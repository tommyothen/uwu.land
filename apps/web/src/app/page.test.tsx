import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import Home from "./page";

vi.mock("@clerk/nextjs", () => ({
	Show: ({ children }: { children: ReactNode }) => children
}));

describe("landing page", () => {
	it("states the founding promise verbatim", () => {
		render(<Home />);
		expect(
			screen.getByText(
				"uwu.land is free forever, and will always be free with no ads or account creation required."
			)
		).toBeInTheDocument();
	});
});
