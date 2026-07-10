import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { Layout } from "./root";

vi.mock("@clerk/react-router", () => ({
	ClerkProvider: ({ children }: { children: ReactNode }) => children
}));

vi.mock("react-router", () => ({
	Links: () => null,
	Meta: () => null,
	Outlet: () => null,
	Scripts: () => null,
	ScrollRestoration: () => null
}));

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
