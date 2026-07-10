import { SignUp } from "@clerk/react-router";

export default function SignUpPage() {
	return (
		<main className="flex min-h-[100dvh] items-center justify-center p-6">
			<SignUp appearance={{ variables: { colorPrimary: "#4f46e5" } }} />
		</main>
	);
}
