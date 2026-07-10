import { useAuth } from "@clerk/react-router";
import type { CreateLinkResponse } from "@uwu/shared";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createLink } from "@/lib/api";
import { friendlyError } from "@/lib/errors";

export function LinkCreate({
	onCreated
}: {
	onCreated: (link: CreateLinkResponse) => void;
}) {
	const { getToken } = useAuth();
	const [url, setUrl] = useState("");
	const [slug, setSlug] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [created, setCreated] = useState<CreateLinkResponse | null>(null);
	const [copied, setCopied] = useState(false);

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (pending || url.trim() === "") {
			return;
		}
		setPending(true);
		setError(null);
		setCreated(null);
		try {
			const token = await getToken();
			if (token === null) {
				return;
			}
			const trimmedSlug = slug.trim();
			const link = await createLink(
				trimmedSlug === ""
					? { url: url.trim() }
					: { url: url.trim(), slug: trimmedSlug },
				token
			);
			setCreated(link);
			setCopied(false);
			setUrl("");
			setSlug("");
			onCreated(link);
		} catch (err) {
			setError(friendlyError(err));
		} finally {
			setPending(false);
		}
	}

	async function copy(link: CreateLinkResponse) {
		await navigator.clipboard.writeText(link.short_url);
		setCopied(true);
	}

	return (
		<form
			onSubmit={submit}
			className="rounded-xl border border-border bg-card p-5"
		>
			<div className="grid gap-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
				<div>
					<Label
						htmlFor="create-url"
						className="block text-sm font-medium text-foreground"
					>
						URL
					</Label>
					<Input
						id="create-url"
						type="url"
						required
						value={url}
						onChange={(event) => setUrl(event.target.value)}
						placeholder="https://example.com/long/link"
						className="mt-2 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder-[color:var(--placeholder)] outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
					/>
				</div>
				<div>
					<Label
						htmlFor="create-slug"
						className="block text-sm font-medium text-foreground"
					>
						Custom slug
					</Label>
					<Input
						id="create-slug"
						type="text"
						value={slug}
						onChange={(event) => setSlug(event.target.value)}
						placeholder="optional"
						className="mt-2 w-full rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm text-foreground placeholder-[color:var(--placeholder)] outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
					/>
				</div>
				<Button
					type="submit"
					disabled={pending}
					className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
				>
					{pending ? "Creating…" : "Create"}
				</Button>
			</div>
			<p className="mt-3 text-xs text-muted-foreground">
				Slugs are 3 to 16 characters: letters, numbers, underscores, hyphens.
			</p>
			{error !== null && (
				<p role="alert" className="mt-3 text-sm text-destructive">
					{error}
				</p>
			)}
			{created !== null && (
				<p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
					<span className="text-muted-foreground">Created</span>
					<span className="font-mono font-medium">
						{created.short_url.replace(/^https?:\/\//, "")}
					</span>
					<Button
						type="button"
						onClick={() => copy(created)}
						className="text-xs font-medium text-[color:var(--ring)] transition hover:opacity-80"
					>
						{copied ? "Copied" : "Copy"}
					</Button>
				</p>
			)}
		</form>
	);
}
