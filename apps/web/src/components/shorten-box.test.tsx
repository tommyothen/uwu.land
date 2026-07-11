import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLink, UwuApiError } from "@/lib/api";
import { ShortenBox } from "./shorten-box";

// Mutable auth stub so individual tests can flip signed-in/out (house pattern:
// see account-panel.test.tsx) without re-mocking the module.
const { authState } = vi.hoisted(() => ({
	authState: {
		isLoaded: true,
		isSignedIn: false,
		getToken: vi.fn(async () => null as string | null)
	}
}));

vi.mock("@clerk/react-router", () => ({
	useAuth: () => authState
}));

// The signed-in result card links to /dashboard; stub Link so it renders without
// a Router context.
vi.mock("react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-router")>();
	return {
		...actual,
		Link: ({
			children,
			to
		}: {
			children: ReactNode;
			to: string;
		}) => <a href={to}>{children}</a>
	};
});

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();
	return { ...actual, createLink: vi.fn() };
});

const createLinkMock = vi.mocked(createLink);
const writeText = vi.fn();

function setReducedMotion(reduced: boolean) {
	window.matchMedia = vi.fn().mockImplementation((query: string) => ({
		matches: reduced,
		media: query,
		onchange: null,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		addListener: vi.fn(),
		removeListener: vi.fn(),
		dispatchEvent: vi.fn()
	}));
}

const link = {
	slug: "abc12",
	short_url: "https://uwu.land/abc12",
	url: "https://example.com/page"
};

async function flush() {
	await act(async () => {
		// A few turns: getToken resolves, then createLink, then apiResult is set.
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	});
}

async function advance(ms: number) {
	await act(async () => {
		vi.advanceTimersByTime(ms);
		await Promise.resolve();
		await Promise.resolve();
	});
}

function submit(url = "https://example.com/page") {
	const input = screen.getByLabelText(/url/i);
	fireEvent.change(input, { target: { value: url } });
	fireEvent.submit(input.closest("form") as HTMLFormElement);
}

beforeEach(() => {
	vi.useFakeTimers();
	setReducedMotion(false);
	authState.isLoaded = true;
	authState.isSignedIn = false;
	authState.getToken = vi.fn(async () => null);
	Object.defineProperty(navigator, "clipboard", {
		value: { writeText },
		configurable: true
	});
});

afterEach(() => {
	vi.runOnlyPendingTimers();
	vi.useRealTimers();
	createLinkMock.mockReset();
	writeText.mockReset();
});

describe("ShortenBox submit choreography", () => {
	it("holds the result until the plane exits on a fast success", async () => {
		createLinkMock.mockResolvedValueOnce(link);
		render(<ShortenBox />);
		submit();
		await flush();

		// API is already back, but the plane has not exited yet.
		expect(screen.queryByText("uwu.land/abc12")).toBeNull();

		await advance(750);
		expect(screen.getByText("uwu.land/abc12")).toBeInTheDocument();
	});

	it("holds at the await label with a static in-transit line on a slow success", async () => {
		let resolve!: (value: typeof link) => void;
		createLinkMock.mockImplementationOnce(
			() => new Promise((r) => (resolve = r))
		);
		render(<ShortenBox />);
		submit();
		await advance(750);

		expect(screen.getByText("in transit…")).toBeInTheDocument();
		expect(screen.queryByText("uwu.land/abc12")).toBeNull();

		await act(async () => {
			resolve(link);
			await Promise.resolve();
		});
		await flush();
		expect(screen.getByText("uwu.land/abc12")).toBeInTheDocument();
	});

	it("stamps RETURN TO SENDER, restores focus and keeps the value on failure", async () => {
		createLinkMock.mockRejectedValueOnce(
			new UwuApiError({ status: 500, code: "internal", message: "boom" })
		);
		render(<ShortenBox />);
		submit();
		await advance(750);
		await advance(1);

		expect(screen.getByText("RETURN TO SENDER")).toBeInTheDocument();
		expect(screen.getByRole("alert")).toHaveTextContent(
			"Something broke on our end. Not your fault. Give it another go."
		);
		const input = screen.getByLabelText(/url/i) as HTMLInputElement;
		expect(input.value).toBe("https://example.com/page");
		expect(document.activeElement).toBe(input);
	});

	it("shows an ink MAILBOX FULL stamp with a 1Hz countdown when retry-after is known", async () => {
		createLinkMock.mockRejectedValueOnce(
			new UwuApiError({
				status: 429,
				code: "rate_limited",
				message: "slow down",
				// biome-ignore lint/suspicious/noExplicitAny: exercising the retry-after envelope field
				retry_after: 42
			} as any)
		);
		render(<ShortenBox />);
		submit();
		await advance(750);

		const stamp = screen.getByText("MAILBOX FULL");
		expect(stamp).toBeInTheDocument();
		expect(stamp.className).toContain("rubber-stamp");
		expect(screen.getByText(/try again in 42s/)).toBeInTheDocument();

		await advance(1000);
		expect(screen.getByText(/try again in 41s/)).toBeInTheDocument();
	});

	it("never launches the plane for a client-side invalid URL", async () => {
		render(<ShortenBox />);
		submit("not a url");
		await flush();

		expect(createLinkMock).not.toHaveBeenCalled();
		expect(screen.getByText("RETURN TO SENDER")).toBeInTheDocument();
		expect(screen.getByRole("alert")).toHaveTextContent(
			"That doesn't look like a link."
		);
	});

	it("copies via the claim ticket and flips the postmark to COPIED", async () => {
		writeText.mockResolvedValue(undefined);
		createLinkMock.mockResolvedValueOnce(link);
		render(<ShortenBox />);
		submit();
		await advance(750);
		await advance(250);

		const ticket = screen.getByRole("button", { name: "Copy short link" });
		await act(async () => {
			fireEvent.click(ticket);
			await Promise.resolve();
		});

		expect(writeText).toHaveBeenCalledWith("https://uwu.land/abc12");
		expect(screen.getByText("copied!")).toBeInTheDocument();
		expect(screen.getByText("COPIED")).toBeInTheDocument();
	});

	it("stacks the result inside the fixed-size envelope shell (zero-CLS contract)", async () => {
		createLinkMock.mockResolvedValueOnce(link);
		const { container } = render(<ShortenBox />);
		// Idle: the shell holds the form; the reserve keeps its footprint from first paint.
		expect(container.querySelector(".envelope-shell > form")).not.toBeNull();

		submit();
		await advance(750);
		await advance(250);

		// Landed: the result is a direct child of the shell via `.result-stack`, which the
		// stylesheet absolutely stacks over the (now-hidden) form so the swap shifts nothing.
		const shell = container.querySelector(".envelope-shell");
		const stack = shell?.querySelector(":scope > .result-stack");
		expect(stack).not.toBeNull();
		expect(stack?.querySelector(".result-card")).not.toBeNull();
		// Only one of form/result occupies the shell at a time.
		expect(container.querySelector(".envelope-shell > form")).toBeNull();
	});

	it("announces the ready link on an aria-live region", async () => {
		createLinkMock.mockResolvedValueOnce(link);
		render(<ShortenBox />);
		submit();
		await advance(750);

		expect(
			screen.getByText("Your short link is ready: uwu.land/abc12")
		).toBeInTheDocument();
	});

	it("survives an unmount mid-flight", async () => {
		createLinkMock.mockImplementationOnce(() => new Promise(() => {}));
		const { unmount } = render(<ShortenBox />);
		submit();
		await flush();
		expect(() => unmount()).not.toThrow();
		await advance(1000);
	});

	it("rebuilds cleanly on a resubmit after an error", async () => {
		createLinkMock
			.mockRejectedValueOnce(
				new UwuApiError({ status: 500, code: "internal", message: "boom" })
			)
			.mockResolvedValueOnce(link);
		render(<ShortenBox />);
		submit();
		await advance(750);
		await advance(1);
		expect(screen.getByText("RETURN TO SENDER")).toBeInTheDocument();

		submit();
		await advance(750);
		expect(screen.getByText("uwu.land/abc12")).toBeInTheDocument();
	});

	it("creates anonymously with a null token when signed out", async () => {
		createLinkMock.mockResolvedValueOnce(link);
		render(<ShortenBox />);
		submit();
		await advance(750);

		expect(createLinkMock).toHaveBeenCalledWith(
			{ url: "https://example.com/page" },
			null
		);
		expect(
			screen.getByText("Delivered. Your link now fits anywhere.")
		).toBeInTheDocument();
	});

	it("passes the Clerk token and acknowledges the account when signed in", async () => {
		authState.isSignedIn = true;
		authState.getToken = vi.fn(async () => "tok_123");
		createLinkMock.mockResolvedValueOnce(link);
		render(<ShortenBox />);
		submit();
		await advance(750);
		await advance(250);

		expect(createLinkMock).toHaveBeenCalledWith(
			{ url: "https://example.com/page" },
			"tok_123"
		);
		expect(screen.getByText(/Filed under your/)).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "account" })).toHaveAttribute(
			"href",
			"/dashboard"
		);
	});

	it("falls back to an anonymous create when getToken unexpectedly returns null", async () => {
		authState.isSignedIn = true;
		authState.getToken = vi.fn(async () => null);
		createLinkMock.mockResolvedValueOnce(link);
		render(<ShortenBox />);
		submit();
		await advance(750);

		expect(createLinkMock).toHaveBeenCalledWith(
			{ url: "https://example.com/page" },
			null
		);
		expect(
			screen.getByText("Delivered. Your link now fits anywhere.")
		).toBeInTheDocument();
	});

	it("crossfades straight to the result under reduced motion (no plane, no in-transit)", async () => {
		setReducedMotion(true);
		createLinkMock.mockResolvedValueOnce(link);
		render(<ShortenBox />);
		submit();
		await flush();
		await advance(1);

		expect(screen.queryByText("in transit…")).toBeNull();
		expect(screen.getByText("uwu.land/abc12")).toBeInTheDocument();
	});
});
