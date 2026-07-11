import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteLink, listLinks } from "@/lib/api";
import { LinkTable } from "./link-table";

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
		listLinks: vi.fn(),
		deleteLink: vi.fn()
	};
});

const listLinksMock = vi.mocked(listLinks);
const deleteLinkMock = vi.mocked(deleteLink);

const rowA = {
	slug: "aaaaa",
	short_url: "https://uwu.land/aaaaa",
	url: "https://example.com/first",
	clicks: 3,
	created_at: "2026-07-09T10:00:00.000Z"
};
const rowB = {
	slug: "bbbbb",
	short_url: "https://uwu.land/bbbbb",
	url: "https://example.com/second",
	clicks: 0,
	created_at: "2026-07-08T10:00:00.000Z",
	external_ref: "discord:123"
};

afterEach(() => {
	listLinksMock.mockReset();
	deleteLinkMock.mockReset();
});

describe("LinkTable", () => {
	it("renders rows from the API", async () => {
		listLinksMock.mockResolvedValueOnce({ links: [rowA, rowB] });
		render(<LinkTable />);

		expect(await screen.findByText("uwu.land/aaaaa")).toBeInTheDocument();
		expect(screen.getByText("uwu.land/bbbbb")).toBeInTheDocument();
		expect(screen.getByText("discord:123")).toBeInTheDocument();
		expect(listLinksMock).toHaveBeenCalledWith("tok", undefined);
	});

	it("loads more with the cursor and appends", async () => {
		listLinksMock.mockResolvedValueOnce({ links: [rowA], cursor: "cur1" });
		listLinksMock.mockResolvedValueOnce({ links: [rowB] });
		const user = userEvent.setup();
		render(<LinkTable />);

		await user.click(
			await screen.findByRole("button", { name: /load more/i })
		);

		expect(listLinksMock).toHaveBeenLastCalledWith("tok", "cur1");
		expect(await screen.findByText("uwu.land/bbbbb")).toBeInTheDocument();
		expect(screen.getByText("uwu.land/aaaaa")).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /load more/i })
		).not.toBeInTheDocument();
	});

	it("deletes a row after inline confirm", async () => {
		listLinksMock.mockResolvedValueOnce({ links: [rowA] });
		deleteLinkMock.mockResolvedValueOnce(undefined);
		const user = userEvent.setup();
		render(<LinkTable />);

		await user.click(await screen.findByRole("button", { name: /delete/i }));
		expect(deleteLinkMock).not.toHaveBeenCalled();
		await user.click(screen.getByRole("button", { name: /confirm/i }));

		expect(deleteLinkMock).toHaveBeenCalledWith("aaaaa", "tok");
		await waitFor(() =>
			expect(screen.queryByText("uwu.land/aaaaa")).not.toBeInTheDocument()
		);
	});

	it("prepends a newly created link", async () => {
		listLinksMock.mockResolvedValueOnce({ links: [rowB] });
		const { rerender } = render(<LinkTable />);
		await screen.findByText("uwu.land/bbbbb");

		rerender(<LinkTable prepend={rowA} />);

		const links = await screen.findAllByText(/uwu\.land\//);
		expect(links[0]).toHaveTextContent("uwu.land/aaaaa");
	});

	it("shows an empty state when there are no links", async () => {
		listLinksMock.mockResolvedValue({ links: [] });
		render(
			<StrictMode>
				<LinkTable />
			</StrictMode>
		);

		expect(await screen.findByText(/no links yet/i)).toBeInTheDocument();
	});
});
