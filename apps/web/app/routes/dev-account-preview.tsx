import { type MeResponse, TIERS } from "@uwu/shared";
import { AccountPanelView } from "@/components/account-panel";

const resetAt = new Date(Date.now() + 5.5 * 3600e3).toISOString();

const FREE_ME: MeResponse = {
	user_id: "user_preview_free",
	tier: "free",
	hasBillingHistory: false,
	plan: null,
	limits: TIERS.free,
	usage: { createdToday: 37, apiKeys: 1, resetAt }
};

const MONTHLY_ME: MeResponse = {
	user_id: "user_preview_monthly",
	tier: "pro",
	hasBillingHistory: true,
	plan: "monthly",
	limits: TIERS.pro,
	usage: { createdToday: 412, apiKeys: 4, resetAt }
};

const LIFETIME_ME: MeResponse = {
	user_id: "user_preview_lifetime",
	tier: "pro",
	hasBillingHistory: true,
	plan: "lifetime",
	limits: TIERS.pro,
	usage: { createdToday: 412, apiKeys: 4, resetAt }
};

const SECTIONS: { heading: string; me: MeResponse }[] = [
	{ heading: "Free · launch offer", me: FREE_ME },
	{ heading: "First-Class · monthly", me: MONTHLY_ME },
	{ heading: "First-Class · lifetime", me: LIFETIME_ME }
];

export default function DevAccountPreview() {
	if (!import.meta.env.DEV) {
		return <p>Not found</p>;
	}

	return (
		<main className="mx-auto w-full max-w-5xl px-6 py-10">
			<div>
				<h1 className="text-2xl font-semibold tracking-tight">Account</h1>
				<div className="grid gap-16">
					{SECTIONS.map((section) => (
						<div key={section.heading}>
							<p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
								{section.heading}
							</p>
							<AccountPanelView
								me={section.me}
								billingPending={null}
								billingError={null}
								upgradePending={false}
								upgradeDelayed={false}
								onCheckout={() => {}}
								onPortal={() => {}}
							/>
						</div>
					))}
				</div>
			</div>
		</main>
	);
}
