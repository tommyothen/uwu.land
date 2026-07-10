import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLink, UwuApiError } from "@/lib/api";
import { LinkCreate } from "./link-create";

vi.mock("@clerk/react-router", () => ({
	useAuth: () => ({ isLoaded: true, isSignedIn: true, getToken: async () => "tok" })
}));

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();
	return {
		...actual,
		createLink: vi.fn()
	};
});

const createLinkMock = vi.mocked(createLink);

afterEach(() => {
	createLinkMock.mockReset();
});

describe("LinkCreate", () => {
	it("creates with a custom slug and reports the new link", async () => {
		createLinkMock.mockResolvedValueOnce({
			slug: "mine",
			short_url: "https://uwu.land/mine",
			url: "https://example.com"
		});
		const onCreated = vi.fn();
		const user = userEvent.setup();
		render(<LinkCreate onCreated={onCreated} />);

		await user.type(screen.getByLabelText(/url/i), "https://example.com");
		await user.type(screen.getByLabelText(/slug/i), "mine");
		await user.click(screen.getByRole("button", { name: /create/i }));

		expect(createLinkMock).toHaveBeenCalledWith(
			{ url: "https://example.com", slug: "mine" },
			"tok"
		);
		expect(onCreated).toHaveBeenCalledWith({
			slug: "mine",
			short_url: "https://uwu.land/mine",
			url: "https://example.com"
		});
		expect(await screen.findByText("uwu.land/mine")).toBeInTheDocument();
	});

	it("omits the slug field when left empty", async () => {
		createLinkMock.mockResolvedValueOnce({
			slug: "r4nd0",
			short_url: "https://uwu.land/r4nd0",
			url: "https://example.com"
		});
		const user = userEvent.setup();
		render(<LinkCreate onCreated={vi.fn()} />);

		await user.type(screen.getByLabelText(/url/i), "https://example.com");
		await user.click(screen.getByRole("button", { name: /create/i }));

		expect(createLinkMock).toHaveBeenCalledWith(
			{ url: "https://example.com" },
			"tok"
		);
	});

	it("renders slug_taken copy on conflict", async () => {
		createLinkMock.mockRejectedValueOnce(
			new UwuApiError({
				status: 409,
				code: "slug_taken",
				message: "Slug is already taken."
			})
		);
		const user = userEvent.setup();
		render(<LinkCreate onCreated={vi.fn()} />);

		await user.type(screen.getByLabelText(/url/i), "https://example.com");
		await user.type(screen.getByLabelText(/slug/i), "mine");
		await user.click(screen.getByRole("button", { name: /create/i }));

		expect(
			await screen.findByText("That slug is already taken. Try another one.")
		).toBeInTheDocument();
	});
});
