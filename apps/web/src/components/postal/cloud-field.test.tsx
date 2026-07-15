import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CLOUD_PATHS, CLOUD_VIEWBOX } from "@/lib/cloud-paths";
import { CloudField } from "./cloud-field";

describe("CloudField", () => {
	it("renders three riso plates back-to-front from the v1 cloud paths", () => {
		const { container } = render(<CloudField />);
		const svgs = container.querySelectorAll("svg");
		expect(svgs).toHaveLength(3);
		svgs.forEach((svg) => {
			expect(svg.getAttribute("viewBox")).toBe(CLOUD_VIEWBOX);
			expect(svg.getAttribute("preserveAspectRatio")).toBe("xMidYMax slice");
		});
		const paths = Array.from(container.querySelectorAll("path"));
		expect(paths).toHaveLength(3);
		// Back-to-front: first plate is cloud-1.
		expect(paths[0]?.getAttribute("fill")).toBe("var(--cloud-1)");
		expect(paths[0]?.getAttribute("d")).toBe(CLOUD_PATHS[0].d);
		expect(paths[2]?.getAttribute("fill")).toBe("var(--cloud-3)");
	});

	it("is decorative (aria-hidden) and carries the ink-grain hook", () => {
		const { container } = render(<CloudField />);
		const field = container.firstElementChild as HTMLElement;
		expect(field.getAttribute("aria-hidden")).toBe("true");
		expect(field.className).toContain("cloud-field");
	});
});
