import { isRecord } from "./request-utils";
import { cancelStripeSubscription } from "./stripe-cancel";
import type { Env } from "./worker";

// Stripe's maximum list page size. Also keeps the per-page deleted_users
// lookup within D1's 100-bound-parameter limit.
const PAGE_SIZE = 100;
// Safety cap so a runaway subscription count cannot pin the scheduled
// handler; at 100 per page this covers 5,000 live subscriptions per sweep.
const MAX_PAGES = 50;
// Statuses that can never bill again. The default subscriptions list already
// excludes canceled, but incomplete_expired can still appear and cancelling
// it is a Stripe error, so both are filtered here.
const TERMINAL_STATUSES = new Set(["canceled", "incomplete_expired"]);

export interface SubscriptionSweepResult {
	scanned: number;
	orphaned: number;
	cancelled: number;
	failed: number;
	skipped: number;
}

interface SweepCandidate {
	subscriptionId: string;
	userId: string;
}

// Reconciliation sweep for any Stripe subscription that outlives our records,
// most notably the race the stripe webhook cannot close: subscription.created
// reads isDeletedUser=false, its guarded insert is then blocked by a
// concurrently-committing deletion, and the resulting live subscription is
// seen by neither the deletion-time cancel (no local row yet) nor the webhook
// backstop (the user read as not deleted). Deletion erases the local
// customer/subscription rows, so the sweep reconciles from Stripe's side: it
// lists every not-yet-canceled subscription, resolves each metadata.userId
// (set at checkout) against deleted_users, and cancels the orphans. Listing
// scales with live subscriptions rather than the never-purged deleted_users
// table and is read-after-write consistent, unlike the Search API. Re-running
// is safe: cancelStripeSubscription treats already-canceled as "ok".
export async function sweepDeletedUserSubscriptions(
	env: Pick<Env, "DB" | "STRIPE_SECRET_KEY">,
	stripeFetch: typeof fetch = fetch
): Promise<SubscriptionSweepResult> {
	const result: SubscriptionSweepResult = {
		scanned: 0,
		orphaned: 0,
		cancelled: 0,
		failed: 0,
		skipped: 0
	};
	const secret = env.STRIPE_SECRET_KEY;
	if (secret === undefined || secret.length === 0) {
		console.error("subscription sweep skipped: STRIPE_SECRET_KEY unset");
		return result;
	}

	let startingAfter: string | null = null;
	for (let page = 0; page < MAX_PAGES; page++) {
		const listed = await listSubscriptionsPage(
			stripeFetch,
			secret,
			startingAfter
		);
		if (listed === null) {
			return result;
		}

		const candidates: SweepCandidate[] = [];
		let lastId: string | null = null;
		for (const entry of listed.entries) {
			if (
				!isRecord(entry) ||
				typeof entry.id !== "string" ||
				entry.id.length === 0
			) {
				continue;
			}
			lastId = entry.id;
			result.scanned++;
			if (
				typeof entry.status === "string" &&
				TERMINAL_STATUSES.has(entry.status)
			) {
				continue;
			}
			const metadata = isRecord(entry.metadata) ? entry.metadata : null;
			const userId = metadata?.userId;
			if (typeof userId !== "string" || userId.length === 0) {
				// Not attributable to an account (e.g. created by hand in the
				// Stripe dashboard); never cancel what we cannot attribute.
				result.skipped++;
				continue;
			}
			candidates.push({ subscriptionId: entry.id, userId });
		}

		const deleted = await deletedUserIds(env.DB, candidates);
		for (const candidate of candidates) {
			if (!deleted.has(candidate.userId)) {
				continue;
			}
			result.orphaned++;
			const outcome = await cancelStripeSubscription(
				stripeFetch,
				secret,
				candidate.subscriptionId
			);
			if (outcome === "ok") {
				result.cancelled++;
			} else {
				result.failed++;
			}
		}

		if (!listed.hasMore || lastId === null) {
			if (result.orphaned > 0) {
				console.log("subscription sweep cancelled orphans", result);
			}
			return result;
		}
		startingAfter = lastId;
	}

	// The next daily run resumes from the top, so truncation only delays
	// orphans past the cap; log it loudly because it means the cap is stale.
	console.error("subscription sweep stopped at the page cap", {
		maxPages: MAX_PAGES,
		...result
	});
	return result;
}

interface SubscriptionsPage {
	entries: unknown[];
	hasMore: boolean;
}

async function listSubscriptionsPage(
	stripeFetch: typeof fetch,
	secret: string,
	startingAfter: string | null
): Promise<SubscriptionsPage | null> {
	const cursor =
		startingAfter === null
			? ""
			: `&starting_after=${encodeURIComponent(startingAfter)}`;
	const url = `https://api.stripe.com/v1/subscriptions?limit=${PAGE_SIZE}${cursor}`;
	let payload: unknown;
	try {
		const response = await stripeFetch(url, {
			headers: { authorization: `Bearer ${secret}` }
		});
		if (!response.ok) {
			console.error("subscription sweep list failed", {
				status: response.status
			});
			return null;
		}
		payload = await response.json();
	} catch {
		console.error("subscription sweep list failed", { status: null });
		return null;
	}
	if (!isRecord(payload) || !Array.isArray(payload.data)) {
		console.error("subscription sweep list returned an invalid payload");
		return null;
	}
	return { entries: payload.data, hasMore: payload.has_more === true };
}

async function deletedUserIds(
	db: D1Database,
	candidates: SweepCandidate[]
): Promise<Set<string>> {
	const userIds = [...new Set(candidates.map((c) => c.userId))];
	if (userIds.length === 0) {
		return new Set();
	}
	const placeholders = userIds.map(() => "?").join(", ");
	const { results } = await db
		.prepare(
			`SELECT user_id FROM deleted_users WHERE user_id IN (${placeholders})`
		)
		.bind(...userIds)
		.all<{ user_id: string }>();
	return new Set(results.map((row) => row.user_id));
}
