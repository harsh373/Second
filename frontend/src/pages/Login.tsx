import { SignIn } from "@clerk/react";
import { AuthLayout } from "../components/auth/AuthLayout";

export default function Login() {
  return (
    <AuthLayout>
      <SignIn routing="path" path="/login" signUpUrl="/signup" fallbackRedirectUrl="/app" />
    </AuthLayout>
  );
}