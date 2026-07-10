import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLink, UwuApiError } from "@/lib/api";
import { ShortenBox } from "./shorten-box";

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();
	return {
		...actual,
		createLink: vi.fn()
	};
});

const createLinkMock = vi.mocked(createLink);
const writeText = vi.fn();

beforeEach(() => {
	Object.defineProperty(navigator, "clipboard", {
		value: { writeText },
		configurable: true
	});
});

afterEach(() => {
	createLinkMock.mockReset();
	writeText.mockReset();
});

describe("ShortenBox", () => {
	it("submits the URL anonymously and shows the short link", async () => {
		createLinkMock.mockResolvedValueOnce({
			slug: "abc12",
			short_url: "https://uwu.land/abc12",
			url: "https://example.com/page"
		});
		const user = userEvent.setup();
		render(<ShortenBox />);

		await user.type(
			screen.getByLabelText(/url/i),
			"https://example.com/page{Enter}"
		);

		expect(createLinkMock).toHaveBeenCalledWith(
			{ url: "https://example.com/page" },
			null
		);
		expect(await screen.findByText("uwu.land/abc12")).toBeInTheDocument();
	});

	it("copies the short URL to the clipboard", async () => {
		createLinkMock.mockResolvedValueOnce({
			slug: "abc12",
			short_url: "https://uwu.land/abc12",
			url: "https://example.com"
		});
		const user = userEvent.setup();
		// user-event installs its own clipboard stub in setup(); reinstate ours.
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText },
			configurable: true
		});
		render(<ShortenBox />);

		await user.type(screen.getByLabelText(/url/i), "https://example.com");
		await user.click(screen.getByRole("button", { name: /send it/i }));
		await user.click(await screen.findByRole("button", { name: /tear \+ copy/i }));

		expect(writeText).toHaveBeenCalledWith("https://uwu.land/abc12");
	});

	it("renders friendly copy for rate_limited errors", async () => {
		createLinkMock.mockRejectedValueOnce(
			new UwuApiError({
				status: 429,
				code: "rate_limited",
				message: "Rate limit exceeded."
			})
		);
		const user = userEvent.setup();
		render(<ShortenBox />);

		await user.type(screen.getByLabelText(/url/i), "https://example.com");
		await user.click(screen.getByRole("button", { name: /send it/i }));

		expect(
			await screen.findByText(
				"Daily anonymous limit reached. Try again tomorrow, or sign up for more."
			)
		).toBeInTheDocument();
	});

	it("disables submit while the request is pending", async () => {
		let resolve: (value: {
			slug: string;
			short_url: string;
			url: string;
		}) => void = () => {};
		createLinkMock.mockImplementationOnce(
			() =>
				new Promise((r) => {
					resolve = r;
				})
		);
		const user = userEvent.setup();
		render(<ShortenBox />);

		await user.type(screen.getByLabelText(/url/i), "https://example.com");
		await user.click(screen.getByRole("button", { name: /send it/i }));

		expect(screen.getByRole("button", { name: /in transit/i })).toBeDisabled();
		resolve({
			slug: "a",
			short_url: "https://uwu.land/a",
			url: "https://example.com"
		});
		await waitFor(() =>
			expect(screen.getByText("uwu.land/a")).toBeInTheDocument()
		);
	});

	it("offers shorten-another after success and returns to the form", async () => {
		createLinkMock.mockResolvedValueOnce({
			slug: "abc12",
			short_url: "https://uwu.land/abc12",
			url: "https://example.com"
		});
		const user = userEvent.setup();
		render(<ShortenBox />);

		await user.type(screen.getByLabelText(/url/i), "https://example.com");
		await user.click(screen.getByRole("button", { name: /send it/i }));
		await user.click(
			await screen.findByRole("button", { name: /send another/i })
		);

		expect(screen.getByLabelText(/url/i)).toBeInTheDocument();
	});
});
