import { verifyWebhook } from "@clerk/backend/webhooks";
import { users } from "@uwu/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import type { Env } from "./worker";

const FIRST_CLASS_PLAN = "first_class";

interface BillingEvent {
	type: string;
	payerUserId: string | null;
	planSlug: string | null;
}

export async function clerkWebhook(
	c: Context<{ Bindings: Env }>
): Promise<Response> {
	let event: BillingEvent;
	try {
		const verified = await verifyWebhook(c.req.raw, {
			signingSecret: c.env.CLERK_WEBHOOK_SIGNING_SECRET
		});
		event = parseBillingEvent(verified);
	} catch {
		return c.text("Invalid webhook signature.", 400);
	}

	if (event.type === "subscriptionItem.canceled") {
		// Access persists until the period ends and "ended" fires.
		return new Response(null, { status: 200 });
	}

	if (event.payerUserId === null || event.planSlug !== FIRST_CLASS_PLAN) {
		return new Response(null, { status: 200 });
	}

	const db = drizzle(c.env.DB);
	if (event.type === "subscriptionItem.active") {
		await db
			.insert(users)
			.values({ id: event.payerUserId, tier: "pro" })
			.onConflictDoUpdate({
				target: users.id,
				set: { tier: "pro" }
			})
			.run();
	} else if (
		event.type === "subscriptionItem.ended" ||
		event.type === "subscriptionItem.abandoned"
	) {
		await db
			.update(users)
			.set({ tier: "free" })
			.where(eq(users.id, event.payerUserId))
			.run();
	}

	return new Response(null, { status: 200 });
}

function parseBillingEvent(event: { type: string; data: unknown }): BillingEvent {
	const data = isRecord(event.data) ? event.data : {};
	const payer = isRecord(data.payer) ? data.payer : {};
	const plan = isRecord(data.plan) ? data.plan : {};

	return {
		type: event.type,
		payerUserId: typeof payer.user_id === "string" ? payer.user_id : null,
		planSlug: typeof plan.slug === "string" ? plan.slug : null
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
