import { render, screen } from "@testing-library/react";
import { TIERS } from "@uwu/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getMe } from "@/lib/api";
import { AccountPanel } from "./account-panel";

vi.mock("@clerk/nextjs", () => ({
	useAuth: () => ({ getToken: async () => "tok" })
}));

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();
	return {
		...actual,
		getMe: vi.fn()
	};
});

const getMeMock = vi.mocked(getMe);

afterEach(() => {
	getMeMock.mockReset();
});

describe("AccountPanel", () => {
	it("renders the current tier and its limits", async () => {
		getMeMock.mockResolvedValueOnce({
			user_id: "user_1",
			tier: "free",
			limits: TIERS.free
		});
		render(<AccountPanel />);

		expect(await screen.findByText(/current plan/i)).toBeInTheDocument();
		expect(screen.getAllByText(/free/i).length).toBeGreaterThan(0);
		expect(
			screen.getByText(String(TIERS.free.createPerDay))
		).toBeInTheDocument();
		expect(screen.getByText(String(TIERS.free.apiPerMin))).toBeInTheDocument();
	});

	it("shows the Pro column as coming soon", async () => {
		getMeMock.mockResolvedValueOnce({
			user_id: "user_1",
			tier: "free",
			limits: TIERS.free
		});
		render(<AccountPanel />);

		expect(await screen.findByText(/coming soon/i)).toBeInTheDocument();
		expect(
			screen.getByText(String(TIERS.pro.createPerDay))
		).toBeInTheDocument();
	});
});
