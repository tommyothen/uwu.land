import { describe, expect, it } from "vitest";
import { CLOUD_PATHS, CLOUD_VIEWBOX } from "./cloud-paths";

describe("cloud paths", () => {
	it("preserves the v1 cloud plates back-to-front", () => {
		expect(CLOUD_VIEWBOX).toBe("0 340 1440 220");
		expect(CLOUD_PATHS[0].token).toBe("--cloud-1");
		for (const path of CLOUD_PATHS) {
			expect(path.d.startsWith("M")).toBe(true);
			expect(path.d).toContain("Q");
		}
	});
});
