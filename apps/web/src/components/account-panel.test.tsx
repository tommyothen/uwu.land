import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TIERS } from "@uwu/shared";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createBillingCheckout,
	createBillingPortal,
	getMe,
	UwuApiError
} from "@/lib/api";
import { AccountPanel } from "./account-panel";

const { mockGetToken } = vi.hoisted(() => ({
	mockGetToken: vi.fn(async () => "tok")
}));

vi.mock("@clerk/react-router", () => ({
	useAuth: () => ({
		isLoaded: true,
		isSignedIn: true,
		getToken: mockGetToken
	})
}));

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();
	return {
		...actual,
		createBillingCheckout: vi.fn(),
		createBillingPortal: vi.fn(),
		getMe: vi.fn()
	};
});

const getMeMock = vi.mocked(getMe);
const createBillingCheckoutMock = vi.mocked(createBillingCheckout);
const createBillingPortalMock = vi.mocked(createBillingPortal);

afterEach(() => {
	getMeMock.mockReset();
	createBillingCheckoutMock.mockReset();
	createBillingPortalMock.mockReset();
	window.history.replaceState(null, "", "/");
	vi.useRealTimers();
});

describe("AccountPanel", () => {
	it("renders the current tier and its limits", async () => {
		getMeMock.mockResolvedValue({
			user_id: "user_1",
			tier: "free",
			hasBillingHistory: false,
			plan: null,
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

	it("shows the First-Class column and lifetime pricing without a coming-soon badge", async () => {
		getMeMock.mockResolvedValueOnce({
			user_id: "user_1",
			tier: "free",
			hasBillingHistory: false,
			plan: null,
			limits: TIERS.free,
			usage: { createdToday: 14, apiKeys: 1, resetAt: null }
		});
		render(<AccountPanel />);

		expect(await screen.findByText("First-Class")).toBeInTheDocument();
		expect(screen.getByText("$3/mo · $59 lifetime")).toBeInTheDocument();
		expect(screen.queryByText("coming soon")).not.toBeInTheDocument();
		expect(
			screen.getByText(String(TIERS.pro.createPerDay))
		).toBeInTheDocument();
	});

	it("presents the launch offer with struck regular prices for free users", async () => {
		getMeMock.mockResolvedValueOnce({
			user_id: "user_1",
			tier: "free",
			hasBillingHistory: false,
			plan: null,
			limits: TIERS.free,
			usage: { createdToday: 14, apiKeys: 1, resetAt: null }
		});
		render(<AccountPanel />);

		// Launch badges advertising the discount, on both checkout cards.
		expect(await screen.findAllByText("Launch offer · 25% off")).toHaveLength(
			2
		);

		// The offer's first-1,000 condition is stated.
		expect(screen.getByText(/first 1,000 customers/i)).toBeInTheDocument();

		// Regular prices survive as struck-through references.
		const struck = document.querySelectorAll("s");
		const struckText = Array.from(struck).map((el) => el.textContent);
		expect(struckText).toContain("$4");
		expect(struckText).toContain("$79");

		// Sticker prices are the launch prices.
		expect(screen.getByText("$3")).toBeInTheDocument();
		expect(screen.getByText("$59")).toBeInTheDocument();

		// Monthly loyalty copy and the lifetime card are both present.
		expect(screen.getByText(/lock in/i)).toBeInTheDocument();
		expect(screen.getByText("Lifetime")).toBeInTheDocument();
	});

	it("renders Stripe checkout choices for free-tier users", async () => {
		getMeMock.mockResolvedValueOnce({
			user_id: "user_1",
			tier: "free",
			hasBillingHistory: false,
			plan: null,
			limits: TIERS.free,
			usage: { createdToday: 14, apiKeys: 1, resetAt: null }
		});
		render(<AccountPanel />);

		expect(
			await screen.findByRole("heading", { name: /upgrade to first-class/i })
		).toBeInTheDocument();
		expect(screen.getByText(/handled securely by Stripe/i)).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Go First-Class, $3 a month" })
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Go First-Class for life, $59 once" })
		).toBeInTheDocument();
		// Pro users' self-service surface must not appear for free users.
		expect(
			screen.queryByRole("button", { name: /manage subscription/i })
		).not.toBeInTheDocument();
	});

	it("starts monthly checkout and redirects to the returned URL", async () => {
		getMeMock.mockResolvedValueOnce({
			user_id: "user_1",
			tier: "free",
			hasBillingHistory: false,
			plan: null,
			limits: TIERS.free,
			usage: { createdToday: 14, apiKeys: 1, resetAt: null }
		});
		createBillingCheckoutMock.mockResolvedValueOnce({ url: "#checkout" });
		const user = userEvent.setup();
		render(<AccountPanel />);

		await user.click(
			await screen.findByRole("button", {
				name: "Go First-Class, $3 a month"
			})
		);

		expect(createBillingCheckoutMock).toHaveBeenCalledWith("tok", "monthly");
		await waitFor(() => expect(window.location.hash).toBe("#checkout"));
	});

	it("starts lifetime checkout when the lifetime card is clicked", async () => {
		getMeMock.mockResolvedValueOnce({
			user_id: "user_1",
			tier: "free",
			hasBillingHistory: false,
			plan: null,
			limits: TIERS.free,
			usage: { createdToday: 14, apiKeys: 1, resetAt: null }
		});
		createBillingCheckoutMock.mockResolvedValueOnce({ url: "#lifetime" });
		const user = userEvent.setup();
		render(<AccountPanel />);

		await user.click(
			await screen.findByRole("button", {
				name: "Go First-Class for life, $59 once"
			})
		);

		expect(createBillingCheckoutMock).toHaveBeenCalledWith("tok", "lifetime");
		await waitFor(() => expect(window.location.hash).toBe("#lifetime"));
	});

	it("disables checkout choices while a request is pending", async () => {
		getMeMock.mockResolvedValueOnce({
			user_id: "user_1",
			tier: "free",
			hasBillingHistory: false,
			plan: null,
			limits: TIERS.free,
			usage: { createdToday: 14, apiKeys: 1, resetAt: null }
		});
		let resolveCheckout: ((value: { url: string }) => void) | undefined;
		createBillingCheckoutMock.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveCheckout = resolve;
			})
		);
		const user = userEvent.setup();
		render(<AccountPanel />);

		const lifetime = await screen.findByRole("button", {
			name: "Go First-Class for life, $59 once"
		});
		await user.click(lifetime);

		expect(lifetime).toBeDisabled();
		expect(lifetime).toHaveTextContent(/opening checkout/i);
		expect(
			screen.getByRole("button", { name: "Go First-Class, $3 a month" })
		).toBeDisabled();
		resolveCheckout?.({ url: "#done" });
		await waitFor(() => expect(window.location.hash).toBe("#done"));
	});

	it("shows a friendly checkout error", async () => {
		getMeMock.mockResolvedValueOnce({
			user_id: "user_1",
			tier: "free",
			hasBillingHistory: false,
			plan: null,
			limits: TIERS.free,
			usage: { createdToday: 14, apiKeys: 1, resetAt: null }
		});
		createBillingCheckoutMock.mockRejectedValueOnce(
			new UwuApiError({
				status: 502,
				code: "billing_unavailable",
				message: "Billing is temporarily unavailable."
			})
		);
		const user = userEvent.setup();
		render(<AccountPanel />);

		await user.click(
			await screen.findByRole("button", {
				name: "Go First-Class, $3 a month"
			})
		);

		expect(await screen.findByRole("alert")).toHaveTextContent(
			/billing is temporarily unavailable/i
		);
	});

	it("lets a monthly subscriber manage billing and make it lifetime", async () => {
		getMeMock.mockResolvedValueOnce({
			user_id: "user_1",
			tier: "pro",
			hasBillingHistory: true,
			plan: "monthly",
			limits: TIERS.pro,
			usage: { createdToday: 2, apiKeys: 1, resetAt: null }
		});
		createBillingPortalMock.mockResolvedValueOnce({ url: "#portal" });
		createBillingCheckoutMock.mockResolvedValueOnce({ url: "#lifetime" });
		const user = userEvent.setup();
		render(<AccountPanel />);

		expect(
			await screen.findByText(/keeping the post office running/i)
		).toBeInTheDocument();

		const manage = screen.getByRole("button", {
			name: /manage subscription/i
		});
		await user.click(manage);
		expect(createBillingPortalMock).toHaveBeenCalledWith("tok");
		await waitFor(() => expect(window.location.hash).toBe("#portal"));

		// The upgrade is not a forfeit, and the card has to say so.
		expect(screen.getByText(/stops renewing/i)).toBeInTheDocument();
		expect(
			screen.getByText(/keep the days you\S*ve already paid for/i)
		).toBeInTheDocument();

		const makeLifetime = screen.getByText(/make it lifetime/i);
		await user.click(makeLifetime);
		expect(createBillingCheckoutMock).toHaveBeenCalledWith("tok", "lifetime");
		await waitFor(() => expect(window.location.hash).toBe("#lifetime"));
	});

	// Mid-upgrade the old subscription is still active, so this user needs a way
	// into the portal to see it winding down.
	it("keeps the portal reachable for a fresh lifetime buyer", async () => {
		getMeMock.mockResolvedValueOnce({
			user_id: "user_1",
			tier: "pro",
			hasBillingHistory: true,
			plan: "lifetime",
			limits: TIERS.pro,
			usage: { createdToday: 2, apiKeys: 1, resetAt: null }
		});
		createBillingPortalMock.mockResolvedValueOnce({ url: "#overlap-portal" });
		const user = userEvent.setup();
		render(<AccountPanel />);

		expect(
			await screen.findByText(/first-class for life/i)
		).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: /receipts/i }));

		expect(createBillingPortalMock).toHaveBeenCalledWith("tok");
		await waitFor(() =>
			expect(window.location.hash).toBe("#overlap-portal")
		);
	});

	it("thanks lifetime owners and hides subscription management", async () => {
		getMeMock.mockResolvedValueOnce({
			user_id: "user_1",
			tier: "pro",
			hasBillingHistory: true,
			plan: "lifetime",
			limits: TIERS.pro,
			usage: { createdToday: 2, apiKeys: 1, resetAt: null }
		});
		createBillingPortalMock.mockResolvedValueOnce({ url: "#receipts" });
		const user = userEvent.setup();
		render(<AccountPanel />);

		expect(
			await screen.findByText(/first-class for life/i)
		).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /manage subscription/i })
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /go first-class/i })
		).not.toBeInTheDocument();
		expect(
			screen.queryByText(/make it lifetime/i)
		).not.toBeInTheDocument();

		const receipts = screen.getByRole("button", {
			name: /receipts & invoices/i
		});
		await user.click(receipts);
		expect(createBillingPortalMock).toHaveBeenCalledWith("tok");
		await waitFor(() => expect(window.location.hash).toBe("#receipts"));
	});

	it("hides the receipts button for lifetime owners without billing history", async () => {
		getMeMock.mockResolvedValueOnce({
			user_id: "user_1",
			tier: "pro",
			hasBillingHistory: false,
			plan: "lifetime",
			limits: TIERS.pro,
			usage: { createdToday: 2, apiKeys: 1, resetAt: null }
		});
		render(<AccountPanel />);

		expect(
			await screen.findByText(/first-class for life/i)
		).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /receipts & invoices/i })
		).not.toBeInTheDocument();
	});

	it("never renders yearly cadence copy in any account state", async () => {
		for (const me of [
			{
				user_id: "u",
				tier: "free" as const,
				hasBillingHistory: false,
				plan: null,
				limits: TIERS.free,
				usage: { createdToday: 1, apiKeys: 0, resetAt: null }
			},
			{
				user_id: "u",
				tier: "pro" as const,
				hasBillingHistory: true,
				plan: "monthly" as const,
				limits: TIERS.pro,
				usage: { createdToday: 1, apiKeys: 0, resetAt: null }
			},
			{
				user_id: "u",
				tier: "pro" as const,
				hasBillingHistory: true,
				plan: "lifetime" as const,
				limits: TIERS.pro,
				usage: { createdToday: 1, apiKeys: 0, resetAt: null }
			}
		]) {
			getMeMock.mockResolvedValueOnce(me);
			const { container, unmount } = render(<AccountPanel />);
			await screen.findByText(/current plan/i);
			expect(container.textContent).not.toMatch(/yearly/i);
			expect(container.textContent).not.toMatch(/\/yr/);
			unmount();
		}
	});

	it("offers the billing portal to a lapsed free user", async () => {
		getMeMock.mockResolvedValueOnce({
			user_id: "user_lapsed",
			tier: "free",
			hasBillingHistory: true,
			plan: null,
			limits: TIERS.free,
			usage: { createdToday: 0, apiKeys: 0, resetAt: null }
		});
		createBillingPortalMock.mockResolvedValueOnce({ url: "#lapsed-portal" });
		const user = userEvent.setup();
		render(<AccountPanel />);

		expect(
			await screen.findByText(/past invoices or fix a failed payment/i)
		).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Billing portal" }));

		expect(createBillingPortalMock).toHaveBeenCalledWith("tok");
		await waitFor(() => expect(window.location.hash).toBe("#lapsed-portal"));
	});

	it("polls after checkout until First-Class is fresh and clears the query", async () => {
		vi.useFakeTimers();
		window.history.replaceState(null, "", "/dashboard/account?upgraded=1");
		getMeMock
			.mockResolvedValueOnce({
				user_id: "user_upgrade",
				tier: "free",
				hasBillingHistory: true,
				plan: null,
				limits: TIERS.free,
				usage: { createdToday: 0, apiKeys: 0, resetAt: null }
			})
			.mockResolvedValueOnce({
				user_id: "user_upgrade",
				tier: "pro",
				hasBillingHistory: true,
				plan: "monthly",
				limits: TIERS.pro,
				usage: { createdToday: 0, apiKeys: 0, resetAt: null }
			});
		render(<AccountPanel />);

		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(
			screen.getByText(/postmaster is stamping your upgrade/i)
		).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /go first-class/i })
		).not.toBeInTheDocument();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(2_000);
		});

		expect(
			screen.getByText(/keeping the post office running/i)
		).toBeInTheDocument();
		expect(window.location.search).toBe("");
	});

	it("returns to the upgrade panel when freshness takes longer than 30 seconds", async () => {
		vi.useFakeTimers();
		window.history.replaceState(null, "", "/dashboard/account?upgraded=1");
		getMeMock.mockResolvedValue({
			user_id: "user_slow_upgrade",
			tier: "free",
			hasBillingHistory: true,
			plan: null,
			limits: TIERS.free,
			usage: { createdToday: 0, apiKeys: 0, resetAt: null }
		});
		render(<AccountPanel />);

		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(
			screen.getByText(/postmaster is stamping your upgrade/i)
		).toBeInTheDocument();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(30_000);
		});

		expect(
			screen.getAllByRole("button", { name: /go first-class/i })
		).toHaveLength(2);
		expect(
			screen.getByText(/taking longer than expected.*refresh in a minute/i)
		).toBeInTheDocument();
	});

	it("surfaces how much of today's quota is used and left", async () => {
		getMeMock.mockResolvedValue({
			user_id: "user_1",
			tier: "free",
			hasBillingHistory: false,
			plan: null,
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
		// Remaining allowance: 250 - 14 = 236.
		expect(screen.getByText(/236 left/i)).toBeInTheDocument();
		// Active API keys used against the allowance.
		expect(screen.getByText(/2 of 2 slots available/i)).toBeInTheDocument();
	});

	it("humanizes the reset time when a window is active", async () => {
		const resetAt = new Date(
			Date.now() + (3 * 60 + 20) * 60 * 1000
		).toISOString();
		getMeMock.mockResolvedValue({
			user_id: "user_1",
			tier: "free",
			hasBillingHistory: false,
			plan: null,
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
			hasBillingHistory: false,
			plan: null,
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
			hasBillingHistory: false,
			plan: null,
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
