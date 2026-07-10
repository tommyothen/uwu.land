import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteKey, listKeys } from "@/lib/api";
import { KeyList } from "./key-list";

vi.mock("@clerk/nextjs", () => ({
	useAuth: () => ({ getToken: async () => "tok" })
}));

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();
	return {
		...actual,
		listKeys: vi.fn(),
		deleteKey: vi.fn()
	};
});

const listKeysMock = vi.mocked(listKeys);
const deleteKeyMock = vi.mocked(deleteKey);

const keyRow = {
	id: "k1",
	name: "hayasaka bot",
	display_prefix: "uwu_a1B2c3D4",
	created_at: "2026-07-09T10:00:00.000Z",
	last_used_at: null
};

afterEach(() => {
	listKeysMock.mockReset();
	deleteKeyMock.mockReset();
});

describe("KeyList", () => {
	it("renders keys with prefix and never-used state", async () => {
		listKeysMock.mockResolvedValueOnce({ keys: [keyRow] });
		render(<KeyList />);

		expect(await screen.findByText("hayasaka bot")).toBeInTheDocument();
		expect(screen.getByText("uwu_a1B2c3D4")).toBeInTheDocument();
		expect(screen.getByText(/never/i)).toBeInTheDocument();
	});

	it("revokes a key after inline confirm", async () => {
		listKeysMock.mockResolvedValueOnce({ keys: [keyRow] });
		deleteKeyMock.mockResolvedValueOnce(undefined);
		const user = userEvent.setup();
		render(<KeyList />);

		await user.click(await screen.findByRole("button", { name: /revoke/i }));
		expect(deleteKeyMock).not.toHaveBeenCalled();
		await user.click(screen.getByRole("button", { name: /confirm/i }));

		expect(deleteKeyMock).toHaveBeenCalledWith("k1", "tok");
		await waitFor(() =>
			expect(screen.queryByText("hayasaka bot")).not.toBeInTheDocument()
		);
	});

	it("shows an empty state", async () => {
		listKeysMock.mockResolvedValueOnce({ keys: [] });
		render(<KeyList />);

		expect(await screen.findByText(/no api keys yet/i)).toBeInTheDocument();
	});
});
