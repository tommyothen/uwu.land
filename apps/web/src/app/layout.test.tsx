import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import RootLayout from "./layout";

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
