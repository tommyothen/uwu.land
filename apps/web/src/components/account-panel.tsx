"use client";

import { useAuth } from "@clerk/react-router";
import { type MeResponse, TIERS } from "@uwu/shared";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow
} from "@/components/ui/table";
import { getMe } from "@/lib/api";
import { friendlyError } from "@/lib/errors";

const ROWS = [
	{
		label: "Links per day",
		value: (tier: "free" | "pro") => TIERS[tier].createPerDay
	},
	{
		label: "API keys",
		value: (tier: "free" | "pro") => TIERS[tier].apiKeys
	}
];

// Humanize the UTC reset instant relative to now. null means the current window
// has not started yet (no create since the last reset), so there is nothing to
// count down to.
function humanizeReset(resetAt: string | null): string {
	if (resetAt === null) {
		return "Resets after your first link today.";
	}
	const diffMs = new Date(resetAt).getTime() - Date.now();
	if (Number.isNaN(diffMs) || diffMs <= 0) {
		return "Resets any moment now.";
	}
	const totalMinutes = Math.floor(diffMs / 60000);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	if (hours > 0) {
		return `Resets in ${hours}h ${minutes}m.`;
	}
	if (minutes > 0) {
		return `Resets in ${minutes}m.`;
	}
	return "Resets in under a minute.";
}

function UsageMeter({
	label,
	used,
	limit,
	unit,
	rightLabel,
	note,
	atLimit
}: {
	label: string;
	used: number;
	limit: number;
	unit: string;
	rightLabel: string;
	note: string;
	atLimit: boolean;
}) {
	const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
	return (
		<div
			className={`rounded-xl border bg-card p-4 ${
				atLimit ? "border-destructive/40" : "border-border"
			}`}
		>
			<div className="flex items-baseline justify-between gap-2">
				<span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
					{label}
				</span>
				<span
					className={`text-xs font-medium ${
						atLimit ? "text-destructive" : "text-muted-foreground"
					}`}
				>
					{rightLabel}
				</span>
			</div>
			<p className="mt-2 flex items-baseline gap-1.5">
				<span className="font-display text-3xl font-semibold leading-none tabular-nums text-foreground">
					{used}
				</span>
				<span className="text-sm text-muted-foreground tabular-nums">
					of {limit} {unit}
				</span>
			</p>
			<div
				role="progressbar"
				aria-label={label}
				aria-valuemin={0}
				aria-valuemax={limit}
				aria-valuenow={used}
				className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary"
			>
				<div
					className={`h-full rounded-full transition-[width] duration-300 ${
						atLimit ? "bg-destructive" : "bg-foreground"
					}`}
					style={{ width: `${pct}%` }}
				/>
			</div>
			<p className="mt-2 text-xs text-muted-foreground">{note}</p>
		</div>
	);
}

export function AccountPanel() {
	const { isLoaded, isSignedIn, getToken } = useAuth();
	const [me, setMe] = useState<MeResponse | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		// Wait for Clerk to resolve the session; getToken() returns null before
		// isLoaded and would strand the UI on its loading skeleton.
		if (!isLoaded) {
			return;
		}
		if (!isSignedIn) {
			return;
		}
		let cancelled = false;
		(async () => {
			const token = await getToken();
			if (token === null) {
				if (!cancelled) {
					setError("Your session expired. Refresh and sign in again.");
				}
				return;
			}
			try {
				const response = await getMe(token);
				if (!cancelled) {
					setMe(response);
				}
			} catch (err) {
				if (!cancelled) {
					setError(friendlyError(err));
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [isLoaded, isSignedIn, getToken]);

	if (error !== null) {
		return (
			<p role="alert" className="mt-6 text-sm text-destructive">
				{error}
			</p>
		);
	}

	if (me === null) {
		return (
			<div className="mt-6 grid gap-3" aria-hidden>
				{[0, 1].map((i) => (
					<Skeleton
						key={i}
						className="h-20 animate-pulse rounded-lg bg-secondary"
					/>
				))}
			</div>
		);
	}

	const created = me.usage.createdToday;
	const createLimit = me.limits.createPerDay;
	const createLeft = Math.max(0, createLimit - created);
	const createAtLimit = created >= createLimit;

	const activeKeys = me.usage.apiKeys;
	const keyLimit = me.limits.apiKeys;
	const keysLeft = Math.max(0, keyLimit - activeKeys);
	const keysAtLimit = activeKeys >= keyLimit;

	return (
		<div className="mt-6">
			<p className="text-sm text-muted-foreground">
				Current plan:{" "}
				<span className="font-medium text-foreground">
					{TIERS[me.tier].displayName}
				</span>
			</p>
			<div className="mt-4 grid gap-3 sm:grid-cols-2">
				<UsageMeter
					label="Links today"
					used={created}
					limit={createLimit}
					unit="used"
					rightLabel={createAtLimit ? "Limit reached" : `${createLeft} left`}
					note={humanizeReset(me.usage.resetAt)}
					atLimit={createAtLimit}
				/>
				<UsageMeter
					label="API keys"
					used={activeKeys}
					limit={keyLimit}
					unit="active"
					rightLabel={keysAtLimit ? "All in use" : `${keysLeft} free`}
					note={
						keysAtLimit
							? "Revoke a key to free a slot."
							: `${keysLeft} of ${keyLimit} ${keyLimit === 1 ? "slot" : "slots"} available.`
					}
					atLimit={keysAtLimit}
				/>
			</div>
			<Table className="mt-6 overflow-x-auto rounded-xl border border-border bg-card text-left text-sm">
				<TableHeader>
					<TableRow className="border-b border-border text-muted-foreground">
						<TableHead className="p-4 font-medium">Limit</TableHead>
						<TableHead
							className={`p-4 font-medium ${
								me.tier === "free" ? "text-foreground" : ""
							}`}
						>
							{TIERS.free.displayName}
							{me.tier === "free" ? " (you)" : ""}
						</TableHead>
						<TableHead
							className={`p-4 font-medium ${
								me.tier === "pro" ? "text-foreground" : ""
							}`}
						>
							<span>
								{TIERS.pro.displayName}
								{me.tier === "pro" ? " (you)" : ""}
								<Badge className="ml-2 rounded-md bg-secondary px-1.5 py-0.5 text-xs font-normal normal-case text-muted-foreground">
									coming soon
								</Badge>
							</span>
							<span className="block text-xs font-normal normal-case text-muted-foreground">
								${TIERS.pro.priceUsdMonthly}/mo · ${TIERS.pro.priceUsdYearly}/yr
							</span>
						</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{ROWS.map((row) => (
							<TableRow
								key={row.label}
								className="border-b border-border last:border-b-0"
							>
								<TableCell className="p-4 text-muted-foreground">
									{row.label}
								</TableCell>
								<TableCell className="p-4 tabular-nums">{row.value("free")}</TableCell>
								<TableCell className="p-4 tabular-nums">{row.value("pro")}</TableCell>
							</TableRow>
						))}
					</TableBody>
			</Table>
			<p className="mt-4 text-xs text-muted-foreground">
				Anonymous shortening stays free forever regardless of plan. First-Class is
				$4/month or $36/year; the upgrade flow is coming soon.
			</p>
		</div>
	);
}
