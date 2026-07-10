import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Stamp } from "./stamp";

describe("Stamp", () => {
	it("renders the three air-mail lines", () => {
		render(<Stamp />);
		expect(screen.getByText("AIR MAIL")).toBeInTheDocument();
		expect(screen.getByText("EST. 2021")).toBeInTheDocument();
	});

	it("is decorative and rotated nine degrees", () => {
		const { container } = render(<Stamp />);
		const stamp = container.firstElementChild as HTMLElement;
		expect(stamp.getAttribute("aria-hidden")).toBe("true");
		expect(stamp.className).toContain("stamp");
	});

	it("honours the size prop", () => {
		const { container } = render(<Stamp size={64} />);
		const stamp = container.firstElementChild as HTMLElement;
		expect(stamp.style.getPropertyValue("--stamp-size")).toBe("64px");
	});
});
