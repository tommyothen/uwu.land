"use client";

import { useAuth } from "@clerk/react-router";
import { type MeResponse, TIERS } from "@uwu/shared";
import { useEffect, useRef, useState } from "react";
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
		label: "API requests per minute",
		value: (tier: "free" | "pro") => TIERS[tier].apiPerMin
	},
	{
		label: "API keys",
		value: (tier: "free" | "pro") => TIERS[tier].apiKeys
	}
];

export function AccountPanel() {
	const { getToken } = useAuth();
	const [me, setMe] = useState<MeResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const loadedInitial = useRef(false);

	useEffect(() => {
		if (loadedInitial.current) {
			return;
		}
		loadedInitial.current = true;
		let cancelled = false;
		(async () => {
			const token = await getToken();
			if (token === null) {
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
	}, [getToken]);

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

	return (
		<div className="mt-6">
			<p className="text-sm text-muted-foreground">
				Current plan:{" "}
				<span className="font-medium capitalize text-foreground">
					{me.tier}
				</span>
			</p>
			<Table className="mt-4 overflow-x-auto rounded-xl border border-border bg-card text-left text-sm">
				<TableHeader>
					<TableRow className="border-b border-border text-muted-foreground">
						<TableHead className="p-4 font-medium">Limit</TableHead>
						<TableHead
								className={`p-4 font-medium capitalize ${
									me.tier === "free"
										? "text-foreground"
										: ""
								}`}
						>
								Free{me.tier === "free" ? " (you)" : ""}
							</TableHead>
						<TableHead
								className={`p-4 font-medium ${
									me.tier === "pro" ? "text-foreground" : ""
								}`}
						>
								Pro{me.tier === "pro" ? " (you)" : ""}
								<Badge className="ml-2 rounded-md bg-secondary px-1.5 py-0.5 text-xs font-normal normal-case text-muted-foreground">
									coming soon
								</Badge>
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
				Anonymous shortening stays free forever regardless of plan. Pro
				pricing lands with the upgrade flow.
			</p>
		</div>
	);
}
