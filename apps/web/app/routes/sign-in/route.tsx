import { SignIn } from "@clerk/react-router";

export default function SignInPage() {
	return (
		<main className="flex min-h-[100dvh] items-center justify-center p-6">
			<SignIn appearance={{ variables: { colorPrimary: "#4f46e5" } }} />
		</main>
	);
}
