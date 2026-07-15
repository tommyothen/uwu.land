import { useAuth } from "@clerk/react-router";
import { type CreateKeyResponse, TIERS } from "@uwu/shared";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createKey, UwuApiError } from "@/lib/api";
import { friendlyError } from "@/lib/errors";

const FREE_API_KEYS: number = TIERS.free.apiKeys;
const KEY_LIMIT_COPY = `The free plan includes ${FREE_API_KEYS} API ${
	FREE_API_KEYS === 1 ? "key" : "keys"
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
			<div className="rounded-xl border-2 border-foreground bg-card p-5 shadow-[3px_3px_0_var(--shadow-ink)]">
				<h2 className="text-sm font-semibold text-foreground">
					{revealed.name}
				</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					This is the only time you'll see this key. Store it now.
				</p>
				<p className="mt-3 break-all rounded-lg border border-border bg-card p-3 font-mono text-sm">
					{revealed.secret}
				</p>
				<div className="mt-4 flex items-center gap-3">
					<Button
						type="button"
						onClick={() => copySecret(revealed)}
						className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 active:scale-[0.98]"
					>
						{copied ? "Copied" : "Copy key"}
					</Button>
					<Button
						type="button"
						onClick={() => dismiss(revealed)}
						variant="outline"
						className="rounded-lg px-4 py-2 text-sm font-medium transition active:scale-[0.98]"
					>
						Done
					</Button>
				</div>
			</div>
		);
	}

	return (
		<form
			onSubmit={submit}
			className="rounded-xl border border-border bg-card p-5"
		>
			<div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
				<div>
					<Label
						htmlFor="key-name"
						className="block text-sm font-medium text-foreground"
					>
						Key name
					</Label>
					<Input
						id="key-name"
						type="text"
						required
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="e.g. my-discord-bot"
						className="mt-2 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder-[color:var(--placeholder)] outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
					/>
				</div>
				<Button
					type="submit"
					disabled={pending}
					className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
				>
					{pending ? "Creating…" : "Create key"}
				</Button>
			</div>
			<p className="mt-3 text-xs text-muted-foreground">
				Use keys as a Bearer token against the public API. See the{" "}
				<Link
					to="/docs"
					className="font-medium text-[color:var(--ring)] transition hover:opacity-80"
				>
					API docs
				</Link>
				.
			</p>
			{error !== null && (
				<p role="alert" className="mt-3 text-sm text-destructive">
					{error}
				</p>
			)}
		</form>
	);
}
