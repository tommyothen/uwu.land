import { A, H2, LegalPage, P } from "@/components/legal-page";
import type { Route } from "./+types/terms";

export const meta: Route.MetaFunction = () => [
	{ title: "Terms of Service | uwu.land" },
	{
		name: "description",
		content:
			"The agreement for using uwu.land: accounts, links, billing, warranties, and governing law (England & Wales)."
	}
];

export default function TermsPage() {
	return (
		<LegalPage title="Terms of Service" lastUpdated="14 July 2026">
			<P>
				These terms are the agreement between you and Tommy Othen, the individual
				who operates uwu.land ("we" and "us"). They apply when you create or
				manage links, call the API, create an account, or subscribe to
				First-Class, and by doing any of those you accept them. If you only follow
				a short link someone else made, these terms do not ask anything of you;
				your visit is covered by the <A href="/privacy">Privacy Policy</A> and the
				law. If you do not accept these terms, do not use the service to create
				links or an account.
			</P>

			<H2 id="eligibility">Who can use it</H2>
			<P>
				You must be at least 13 to use uwu.land, and old enough to enter a
				binding contract (18 in most of the UK) to buy First-Class. If you use
				the service for an organisation, you confirm you are authorised to accept
				these terms on its behalf.
			</P>

			<H2 id="what-it-is">What the service is</H2>
			<P>
				uwu.land is a URL shortener: the tiny link post office. You hand it a
				long URL, it hands you a short one, and it forwards visitors to the
				destination. Anyone can shorten links anonymously with a random slug,
				free forever, with no ads and no account. An optional account adds a
				dashboard, API keys, custom slugs, and link management. A paid tier,
				First-Class, raises usage limits.
			</P>

			<H2 id="account-and-links">Your account and your links</H2>
			<P>
				If you create an account, keep your credentials and API keys secret. An
				API key acts as your account: anything done with your key is treated as
				done by you. If a key leaks, revoke it from the dashboard.
			</P>
			<P>
				You are responsible for every link you create and for its destination,
				including what the destination later becomes. Shortening a link does not
				make us the publisher of what is behind it.
			</P>

			<H2 id="acceptable-use">Acceptable use</H2>
			<P>
				Use of the service is governed by the{" "}
				<A href="/acceptable-use">Acceptable Use Policy</A>, which lists what you
				may not link to and the measures we may take. It is part of these terms.
				In short: no phishing, no malware, no illegal content, no spam, and no
				redirect loops back into uwu.land.
			</P>

			<H2 id="billing">Paid tier and billing</H2>
			<P>
				First-Class costs US$4 per month or US$36 per year, billed through Stripe,
				and renews automatically until cancelled. Billing, cancellation, and
				refunds are covered by the{" "}
				<A href="/refunds">Refund &amp; Cancellation Policy</A>, which is part of
				these terms. The free and anonymous tiers are free to use, and we intend
				to keep them that way.
			</P>

			<H2 id="ip">Intellectual property</H2>
			<P>
				The uwu.land source code is open source at{" "}
				<A href="https://github.com/tommyothen/uwu.land">
					github.com/tommyothen/uwu.land
				</A>
				, under the licence stated in that repository. These terms do not grant
				you rights to the uwu.land name or domain. You keep whatever rights you
				have in the URLs you shorten. You grant us permission to store them and
				redirect visitors to them, which is the whole point.
			</P>

			<H2 id="no-warranty">Service quality and availability</H2>
			<P>
				We provide the service with reasonable care and skill, and nothing in
				these terms takes away the statutory rights you have as a consumer,
				including the right to a service carried out with reasonable care and
				skill. Beyond those rights, the service is provided "as is" and "as
				available". This is a low-cost service run by one person, not a fleet of
				engineers on call, so there is no uptime guarantee and no service-level
				agreement. Links may occasionally be unreachable, and features may change.
				Do not put a uwu.land link somewhere a dead link would cause real harm.
			</P>

			<H2 id="changes-to-service">Changes to the service</H2>
			<P>
				We may change, suspend, or discontinue the service or a feature for good
				reason, such as legal, security, abuse-prevention, technical, or supplier
				reasons. Where a change is significant we will give reasonable notice if
				we can. If we ever discontinue a paid feature you have already paid for,
				we will let you keep it until the end of your paid period or give you a
				proportionate refund.
			</P>

			<H2 id="liability">Limitation of liability</H2>
			<P>
				Nothing in these terms limits liability for death or personal injury
				caused by negligence, for fraud or fraudulent misrepresentation, or for
				anything else that cannot be limited under the law of England and Wales,
				and nothing limits your non-excludable rights as a consumer.
			</P>
			<P>
				Subject to that, we are not liable for loss that was not reasonably
				foreseeable or that did not arise from our breach, including indirect or
				consequential loss, loss of profits, loss of data, or loss of business.
				For paying subscribers, our total liability is capped at the amount you
				paid in the 12 months before the claim arose. Where you use the service
				as a business rather than a consumer, these limits apply so far as the law
				allows.
			</P>

			<H2 id="termination">Termination</H2>
			<P>
				You can stop using the service at any time, and account holders can close
				their account from the dashboard or by emailing us. We may suspend or
				terminate accounts and remove links for violations of these terms or the{" "}
				<A href="/acceptable-use">Acceptable Use Policy</A>, as described there.
			</P>

			<H2 id="changes-to-terms">Changes to these terms</H2>
			<P>
				When these terms change, the "Last updated" date changes, and significant
				changes are flagged on the site. We will also email account holders where
				a change affects them materially and we can reasonably reach them.
				Continuing to use the service after a change takes effect means you accept
				the updated terms.
			</P>

			<H2 id="governing-law">Governing law</H2>
			<P>
				These terms are governed by the law of England and Wales. If you use the
				service as a consumer, you keep the mandatory protections of the law
				where you live, and you can bring proceedings in the courts there. For
				everyone else, the courts of England and Wales have jurisdiction.
			</P>

			<H2 id="general">General</H2>
			<P>
				If any part of these terms is found invalid, the rest still applies. If
				we do not enforce a right straight away, we can still enforce it later. We
				are not responsible for delays or failures caused by events outside our
				reasonable control. You may not transfer your rights under these terms
				without our consent, and we may transfer ours if the service changes
				hands, without reducing your rights. Someone who is not a party to these
				terms has no right to enforce them under the Contracts (Rights of Third
				Parties) Act 1999.
			</P>

			<H2 id="contact">Contact</H2>
			<P>
				Questions about these terms:{" "}
				<A href="mailto:hello@uwu.land">hello@uwu.land</A>.
			</P>
		</LegalPage>
	);
}
