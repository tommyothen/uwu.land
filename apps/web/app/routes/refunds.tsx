import { A, H2, LegalPage, LI, P, UL } from "@/components/legal-page";
import type { Route } from "./+types/refunds";

export const meta: Route.MetaFunction = () => [
	{ title: "Refund & Cancellation Policy | uwu.land" },
	{
		name: "description",
		content:
			"How First-Class billing, cancellation, and refunds work on uwu.land. Free and anonymous tiers are free forever."
	}
];

export default function RefundsPage() {
	return (
		<LegalPage title="Refund & Cancellation Policy" lastUpdated="14 July 2026">
			<P>
				This policy covers First-Class, uwu.land's only paid tier. It forms part
				of the <A href="/terms">Terms of Service</A>. If you never pay for
				anything, none of this applies to you: the free and anonymous tiers are
				free forever, with nothing to cancel.
			</P>

			<H2 id="pricing">Pricing and billing</H2>
			<P>
				First-Class costs US$4 per month or US$36 per year, billed through Stripe
				(cards, and PayPal via Stripe Checkout). Prices are in US dollars. Any
				sales tax or VAT that applies is shown at checkout and added to that
				price. Subscriptions renew automatically at the end of each billing
				period until you cancel. We do not store your card details; see the{" "}
				<A href="/privacy">Privacy Policy</A> for how payment data is handled.
			</P>

			<H2 id="cancelling">Cancelling</H2>
			<P>
				Cancel anytime from the account dashboard at app.uwu.land, which opens
				the Stripe Billing Portal. Cancelling there takes effect at the end of
				the period you have already paid for: you keep First-Class until then,
				and you are not charged again. Note that closing your whole account is
				different: it cancels the subscription at that point rather than at the
				period end, so cancel through the portal first if you want to use the
				time you have paid for.
			</P>

			<H2 id="statutory-right">Your statutory cancellation right (UK)</H2>
			<P>
				Under the Consumer Contracts Regulations 2013, UK consumers have 14 days
				to cancel a contract for a digital service. First-Class gives you access
				straight away, so by subscribing you ask us to start the service during
				that period. If you cancel within the 14 days, we will refund what you
				paid, and we may keep a proportionate amount for the part of the period
				you have already used. Tell us at{" "}
				<A href="mailto:support@uwu.land">support@uwu.land</A> to cancel this way.
				Nothing here removes your statutory rights. We are still settling the
				exact wording of this section with a consumer-law adviser, and we will
				always honour your legal rights.
			</P>

			<H2 id="when-we-refund">When we do refund</H2>
			<P>
				Beyond your statutory rights, some charges should not stand, and we
				refund them without a fight:
			</P>
			<UL>
				<LI>Accidental or duplicate charges.</LI>
				<LI>Obvious billing errors.</LI>
				<LI>
					A charge that lands right after a renewal you did not intend, for
					example when you meant to cancel and the renewal beat you to it.
				</LI>
			</UL>
			<P>
				Email <A href="mailto:support@uwu.land">support@uwu.land</A> within 30
				days of the charge, with your account email and the Stripe receipt or
				invoice number. Never send your card number, security code, or any
				password. Refunds go back to your original payment method, usually within
				a few working days. This is a one-person operation, so you will be
				talking to the person who can actually issue the refund.
			</P>

			<H2 id="contact">Contact</H2>
			<P>
				Billing questions and refund requests:{" "}
				<A href="mailto:support@uwu.land">support@uwu.land</A>.
			</P>
		</LegalPage>
	);
}
