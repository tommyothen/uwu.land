import { SignIn } from "@clerk/react-router";
import { AirmailStripe } from "@/components/postal/airmail-stripe";

export default function SignInPage() {
	return (
		<div className="relative min-h-[100dvh]">
			<AirmailStripe />
			<main className="flex min-h-[100dvh] items-center justify-center p-6">
				<SignIn />
			</main>
		</div>
	);
}
