import { render, screen } from "@testing-library/react";
import { TIERS } from "@uwu/shared";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getMe } from "@/lib/api";
import { AccountPanel } from "./account-panel";

const { mockGetToken } = vi.hoisted(() => ({
	mockGetToken: vi.fn(async () => "tok")
}));

vi.mock("@clerk/react-router", () => ({
	useAuth: () => ({ isLoaded: true, isSignedIn: true, getToken: mockGetToken })
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
		getMeMock.mockResolvedValue({
			user_id: "user_1",
			tier: "free",
			limits: TIERS.free,
			usage: { createdToday: 14, apiKeys: 1, resetAt: null }
		});
		render(
			<StrictMode>
				<AccountPanel />
			</StrictMode>
		);

		expect(await screen.findByText(/current plan/i)).toBeInTheDocument();
		expect(screen.getAllByText(/free/i).length).toBeGreaterThan(0);
		expect(
			screen.getByText(String(TIERS.free.createPerDay))
		).toBeInTheDocument();
	});

	it("shows the First-Class column, pricing, and coming-soon badge", async () => {
		getMeMock.mockResolvedValueOnce({
			user_id: "user_1",
			tier: "free",
			limits: TIERS.free,
			usage: { createdToday: 14, apiKeys: 1, resetAt: null }
		});
		render(<AccountPanel />);

		expect(await screen.findByText("First-Class")).toBeInTheDocument();
		expect(screen.getByText("$4/mo · $36/yr")).toBeInTheDocument();
		expect(screen.getByText("coming soon", { exact: true })).toBeInTheDocument();
		expect(
			screen.getByText(String(TIERS.pro.createPerDay))
		).toBeInTheDocument();
	});

	it("surfaces how much of today's quota is used and left", async () => {
		getMeMock.mockResolvedValue({
			user_id: "user_1",
			tier: "free",
			limits: TIERS.free,
			usage: { createdToday: 14, apiKeys: 0, resetAt: null }
		});
		render(
			<StrictMode>
				<AccountPanel />
			</StrictMode>
		);

		// Used count for the daily window.
		expect(await screen.findByText("14")).toBeInTheDocument();
		// Remaining allowance: 120 - 14 = 106.
		expect(screen.getByText(/106 left/i)).toBeInTheDocument();
		// Active API keys used against the allowance.
		expect(screen.getByText(/1 of 1 slot available/i)).toBeInTheDocument();
	});

	it("humanizes the reset time when a window is active", async () => {
		const resetAt = new Date(
			Date.now() + (3 * 60 + 20) * 60 * 1000
		).toISOString();
		getMeMock.mockResolvedValue({
			user_id: "user_1",
			tier: "free",
			limits: TIERS.free,
			usage: { createdToday: 14, apiKeys: 1, resetAt }
		});
		render(
			<StrictMode>
				<AccountPanel />
			</StrictMode>
		);

		expect(await screen.findByText(/resets in 3h/i)).toBeInTheDocument();
	});

	it("handles a null reset instant before the first link of the day", async () => {
		getMeMock.mockResolvedValue({
			user_id: "user_1",
			tier: "free",
			limits: TIERS.free,
			usage: { createdToday: 0, apiKeys: 1, resetAt: null }
		});
		render(
			<StrictMode>
				<AccountPanel />
			</StrictMode>
		);

		expect(
			await screen.findByText(/after your first link/i)
		).toBeInTheDocument();
	});

	it("renders a distinct at-limit treatment when the quota is spent", async () => {
		getMeMock.mockResolvedValue({
			user_id: "user_1",
			tier: "free",
			limits: TIERS.free,
			usage: {
				createdToday: TIERS.free.createPerDay,
				apiKeys: 1,
				resetAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
			}
		});
		render(
			<StrictMode>
				<AccountPanel />
			</StrictMode>
		);

		// The at-limit copy replaces the "N left" label.
		expect(await screen.findByText(/limit reached/i)).toBeInTheDocument();
		// The daily meter fills to 100% and switches to the destructive fill.
		const meter = screen.getByRole("progressbar", { name: /links today/i });
		const fill = meter.firstElementChild as HTMLElement;
		expect(fill).toHaveClass("bg-destructive");
		expect(fill.style.width).toBe("100%");
	});
});
