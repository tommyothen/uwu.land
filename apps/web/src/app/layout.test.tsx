import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import RootLayout from "./layout";

vi.mock("@clerk/nextjs", () => ({
	ClerkProvider: ({ children }: { children: ReactNode }) => children
}));

vi.mock("geist/font/sans", () => ({
	GeistSans: { variable: "font-geist-sans" }
}));

vi.mock("geist/font/mono", () => ({
	GeistMono: { variable: "font-geist-mono" }
}));

describe("RootLayout", () => {
	it("renders its children without crashing", () => {
		const { getByText } = render(
			<RootLayout>
				<p>hello</p>
			</RootLayout>
		);
		expect(getByText("hello")).toBeInTheDocument();
	});
});
