import { A, C, H2, LegalPage, LI, P, UL } from "@/components/legal-page";
import type { Route } from "./+types/privacy";

export const meta: Route.MetaFunction = () => [
	{ title: "Privacy Policy | uwu.land" },
	{
		name: "description",
		content:
			"What uwu.land collects, why, the lawful bases we rely on, and how long we keep it. We collect little and track no one."
	}
];

export default function PrivacyPage() {
	return (
		<LegalPage title="Privacy Policy" lastUpdated="14 July 2026">
			<P>
				uwu.land is a URL shortener, the tiny link post office. This policy
				explains what data the service collects, why, the lawful bases we rely
				on, and how long we keep it. We collect little, and we track no one.
			</P>

			<H2 id="who-runs-this">Who runs this</H2>
			<P>
				uwu.land is operated by Tommy Othen, an individual based in the United
				Kingdom, who is the data controller for the personal data described
				here. It is not a company. The service lives at <C>uwu.land</C> (short
				links and the public API) and <C>app.uwu.land</C> (the web app and
				dashboard). The code is open source at{" "}
				<A href="https://github.com/tommyothen/uwu.land">
					github.com/tommyothen/uwu.land
				</A>
				, so you can check these claims against the source.
			</P>
			<P>
				For anything privacy-related, email{" "}
				<A href="mailto:hello@uwu.land">hello@uwu.land</A>.
			</P>

			<H2 id="anonymous">Shortening a link without an account</H2>
			<P>
				Anyone can shorten a link with no account, and this stays free forever,
				with no ads. Each link we store holds the destination URL, the slug, how
				the link was created (anonymous, API, or dashboard), when it was created,
				its running click count, and a small amount of internal bookkeeping (a
				hash of the URL and its lifecycle state). Anonymous links have no owner
				attached.
			</P>
			<P>
				When you create a link, your IP address (from Cloudflare's{" "}
				<C>CF-Connecting-IP</C> header) is used to enforce rate limits and to
				block abuse. It is held as a pseudonymous key in a Cloudflare Durable
				Object and cleared after the block or rate-limit window passes (about 24
				hours). It is never sold, never used to build a profile of you, and never
				used for advertising. Anonymous shortening sets no cookies.
			</P>

			<H2 id="click-analytics">Click analytics</H2>
			<P>
				When someone follows a short link, we write one analytics event with
				three fields: the slug, the visitor's country (which Cloudflare derives
				from the IP), and the hostname of the referring site. That event contains
				no IP address and no user-agent. It runs on Cloudflare's first-party
				Analytics Engine, which keeps these events for about three months. The
				per-link total click count shown publicly is the sum of these events.
			</P>
			<P>
				Separately, Cloudflare's platform keeps short-lived operational logs for
				the workers that run the service. Like any web server, these record
				standard request metadata, which can include IP addresses, for a few
				days before they roll off. We use them only to diagnose faults, not to
				track anyone. There is no cross-site tracking and no ad network anywhere
				on uwu.land.
			</P>

			<H2 id="accounts">If you create an account</H2>
			<P>
				Accounts are optional. They unlock the dashboard, API keys, custom slugs,
				and link management. Authentication is handled by Clerk, which stores
				your email address and authentication profile. On our own side we keep
				your Clerk user ID, your tier, when the account was created, and a hash
				of your email used only to prevent abuse of the free limits.
			</P>
			<P>
				Signing in sets the session cookies Clerk needs to keep you logged in,
				and Stripe may set its own cookies on its checkout pages. These are
				essential to the service working, not tracking cookies.
			</P>
			<P>
				For each API key we store its name, a display prefix, one-way hash, and
				created, last-used, and revoked timestamps. The secret itself is stored
				only as a one-way hash. You see the full secret once, at creation, and we
				cannot show it to you again because we do not have it.
			</P>

			<H2 id="payments">If you pay for First-Class</H2>
			<P>
				Payments (cards, and PayPal via Stripe Checkout) are processed by Stripe.
				We never see or store your card number; Stripe holds all payment data. On
				our side we keep a Stripe customer and subscription reference, your plan
				and its status, your resulting tier, and a record of the billing events
				Stripe sends us so we do not process the same one twice.
			</P>

			<H2 id="theme">Your theme preference</H2>
			<P>
				Light or dark mode is stored in your browser's localStorage under the key{" "}
				<C>uwu-theme</C>. It never leaves your browser.
			</P>

			<H2 id="lawful-bases">Why we are allowed to use your data</H2>
			<P>
				Under UK GDPR we rely on these lawful bases, depending on what the data
				is for:
			</P>
			<UL>
				<LI>
					<strong>Contract</strong>, to run your account and your First-Class
					subscription.
				</LI>
				<LI>
					<strong>Legitimate interests</strong>, to deliver redirects, keep the
					service secure, prevent abuse, and understand basic aggregate usage.
					These interests are balanced against your rights and kept to the
					minimum data needed.
				</LI>
				<LI>
					<strong>Legal obligation</strong>, to keep limited billing records for
					tax and to respond to lawful requests.
				</LI>
			</UL>

			<H2 id="processors">Who else handles your data</H2>
			<P>
				Three providers do the heavy lifting. Clerk handles authentication and
				account management. Stripe handles payment processing and subscription
				billing, and for some fraud, compliance, and payment purposes Stripe acts
				as its own controller rather than only on our behalf. Cloudflare provides
				hosting, CDN, edge compute (Workers), the database (D1), key-value
				storage (KV), and click analytics (Analytics Engine).
			</P>
			<P>
				These providers may process data in the United States. Transfers outside
				the UK rely on appropriate safeguards, such as Standard Contractual
				Clauses with the UK International Data Transfer Addendum, or an adequacy
				decision where one applies. Ask us at{" "}
				<A href="mailto:hello@uwu.land">hello@uwu.land</A> for details of the
				safeguards. We may also disclose information to competent authorities
				where the law requires it or to report serious abuse (see the{" "}
				<A href="/acceptable-use">Acceptable Use Policy</A>).
			</P>

			<H2 id="retention">How long data is kept, and account closure</H2>
			<P>
				Short links persist until their owner deletes them; anonymous links
				persist unless removed for abuse. When you close your account, we delete
				or anonymise the personal data tied to it, including your API keys and
				billing mappings, keeping only limited records the law requires us to
				retain (for example for tax) and, for about 30 days, a hashed version of
				your email address so a closed account cannot be reopened to reset
				free-tier limits. Links you created may keep working as
				anonymous links, so delete any you want gone before closing. Abuse and
				rate-limit state is cleared after its window (about 24 hours), and
				analytics events roll off at about three months.
			</P>

			<H2 id="your-rights">Your rights</H2>
			<P>
				Under UK GDPR and the Data Protection Act 2018 you can, where applicable,
				ask for access to your data, correction, erasure, restriction of
				processing, a portable copy, or object to processing, and where we rely
				on consent you can withdraw it. Which rights apply depends on the lawful
				basis above. Email{" "}
				<A href="mailto:hello@uwu.land">hello@uwu.land</A> and we will respond
				within one month, after taking reasonable steps to verify who you are.
			</P>
			<P>
				If you want to complain about how we handle your data, email the same
				address. We will acknowledge your complaint within 30 days, look into it,
				and tell you the outcome. You can also complain to the UK Information
				Commissioner's Office (ICO) at <A href="https://ico.org.uk">ico.org.uk</A>.
			</P>

			<H2 id="changes">Changes to this policy</H2>
			<P>
				If this policy changes in a way that matters, the "Last updated" date
				above changes with it, and significant changes will be flagged on the
				site. The <A href="/terms">Terms of Service</A> and{" "}
				<A href="/acceptable-use">Acceptable Use Policy</A> cover how you may use
				the service; the <A href="/refunds">Refund &amp; Cancellation Policy</A>{" "}
				covers paid subscriptions.
			</P>

			<H2 id="contact">Contact</H2>
			<P>
				Questions, requests, or concerns:{" "}
				<A href="mailto:hello@uwu.land">hello@uwu.land</A>.
			</P>
		</LegalPage>
	);
}
