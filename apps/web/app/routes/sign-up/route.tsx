import { SignUp } from "@clerk/react-router";
import { AirmailStripe } from "@/components/postal/airmail-stripe";

export default function SignUpPage() {
	return (
		<div className="relative min-h-[100dvh]">
			<AirmailStripe />
			<main className="flex min-h-[100dvh] items-center justify-center p-6">
				<SignUp />
			</main>
		</div>
	);
}
