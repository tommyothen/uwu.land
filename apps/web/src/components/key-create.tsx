import { useAuth } from "@clerk/react-router";
import { type CreateKeyResponse, TIERS } from "@uwu/shared";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { createKey, UwuApiError } from "@/lib/api";
import { friendlyError } from "@/lib/errors";

const KEY_LIMIT_COPY = `The free plan includes ${TIERS.free.apiKeys} API ${
	TIERS.free.apiKeys === 1 ? "key" : "keys"
}. Revoke an existing key to create a new one.`;

export function KeyCreate({
	onCreated
}: {
	onCreated: (key: CreateKeyResponse) => void;
}) {
	const { getToken } = useAuth();
	const [name, setName] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// The secret lives only in this component state, revealed exactly once.
	const [revealed, setRevealed] = useState<CreateKeyResponse | null>(null);
	const [copied, setCopied] = useState(false);

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (pending || name.trim() === "") {
			return;
		}
		setPending(true);
		setError(null);
		try {
			const token = await getToken();
			if (token === null) {
				return;
			}
			const key = await createKey({ name: name.trim() }, token);
			setRevealed(key);
			setCopied(false);
			setName("");
		} catch (err) {
			if (err instanceof UwuApiError && err.code === "key_limit") {
				setError(KEY_LIMIT_COPY);
			} else {
				setError(friendlyError(err));
			}
		} finally {
			setPending(false);
		}
	}

	async function copySecret(key: CreateKeyResponse) {
		await navigator.clipboard.writeText(key.secret);
		setCopied(true);
	}

	function dismiss(key: CreateKeyResponse) {
		setRevealed(null);
		onCreated(key);
	}

	if (revealed !== null) {
		return (
			<div className="rounded-xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-800/60 dark:bg-amber-950/30">
				<h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
					{revealed.name}
				</h2>
				<p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
					This is the only time you'll see this key. Store it now.
				</p>
				<p className="mt-3 break-all rounded-lg border border-zinc-200 bg-white p-3 font-mono text-sm dark:border-zinc-800 dark:bg-zinc-950">
					{revealed.secret}
				</p>
				<div className="mt-4 flex items-center gap-3">
					<button
						type="button"
						onClick={() => copySecret(revealed)}
						className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 active:scale-[0.98]"
					>
						{copied ? "Copied" : "Copy key"}
					</button>
					<button
						type="button"
						onClick={() => dismiss(revealed)}
						className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 active:scale-[0.98] dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
					>
						Done
					</button>
				</div>
			</div>
		);
	}

	return (
		<form
			onSubmit={submit}
			className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
		>
			<div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
				<div>
					<label
						htmlFor="key-name"
						className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
					>
						Key name
					</label>
					<input
						id="key-name"
						type="text"
						required
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="e.g. my-discord-bot"
						className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder-zinc-500"
					/>
				</div>
				<button
					type="submit"
					disabled={pending}
					className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
				>
					{pending ? "Creating…" : "Create key"}
				</button>
			</div>
			<p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
				Use keys as a Bearer token against the public API. See the{" "}
				<Link
					to="/docs"
					className="font-medium text-indigo-600 transition hover:text-indigo-500 dark:text-indigo-400"
				>
					API docs
				</Link>
				.
			</p>
			{error !== null && (
				<p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
					{error}
				</p>
			)}
		</form>
	);
}
