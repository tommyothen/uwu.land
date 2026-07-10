import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TIERS } from "@uwu/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createKey, UwuApiError } from "@/lib/api";
import { KeyCreate } from "./key-create";

vi.mock("@clerk/nextjs", () => ({
	useAuth: () => ({ getToken: async () => "tok" })
}));

vi.mock("@/lib/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api")>();
	return {
		...actual,
		createKey: vi.fn()
	};
});

const createKeyMock = vi.mocked(createKey);
const SECRET = "uwu_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6";

afterEach(() => {
	createKeyMock.mockReset();
});

describe("KeyCreate", () => {
	it("reveals the secret once with a working copy button, gone after dismiss", async () => {
		createKeyMock.mockResolvedValueOnce({
			id: "k1",
			name: "bot",
			secret: SECRET,
			display_prefix: "uwu_a1B2c3D4"
		});
		const writeText = vi.fn();
		const onCreated = vi.fn();
		const user = userEvent.setup();
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText },
			configurable: true
		});
		render(<KeyCreate onCreated={onCreated} />);

		await user.type(screen.getByLabelText(/name/i), "bot");
		await user.click(screen.getByRole("button", { name: /create/i }));

		expect(await screen.findByText(SECRET)).toBeInTheDocument();
		expect(
			screen.getByText(/only time you'll see this key/i)
		).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: /copy/i }));
		expect(writeText).toHaveBeenCalledWith(SECRET);

		await user.click(screen.getByRole("button", { name: /done/i }));
		expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
		expect(onCreated).toHaveBeenCalledWith(
			expect.objectContaining({ id: "k1", name: "bot" })
		);
	});

	it("renders tier-aware copy for key_limit", async () => {
		createKeyMock.mockRejectedValueOnce(
			new UwuApiError({
				status: 409,
				code: "key_limit",
				message: "API key limit reached."
			})
		);
		const user = userEvent.setup();
		render(<KeyCreate onCreated={vi.fn()} />);

		await user.type(screen.getByLabelText(/name/i), "bot");
		await user.click(screen.getByRole("button", { name: /create/i }));

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain(String(TIERS.free.apiKeys));
	});
});
