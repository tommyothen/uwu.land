import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import ShortLinkNotFound from "./not-found";

describe("dead letter office (404)", () => {
	it("presses the red RETURN TO SENDER stamp and points home", () => {
		render(
			<MemoryRouter>
				<ShortLinkNotFound />
			</MemoryRouter>
		);
		expect(screen.getByText("404")).toBeInTheDocument();
		expect(screen.getByText("RETURN TO SENDER")).toBeInTheDocument();
		expect(screen.getByText("NO SUCH ADDRESS")).toBeInTheDocument();
		const cta = screen.getByRole("link", { name: "Back to the post office" });
		expect(cta).toHaveAttribute("href", "/");
	});
});
