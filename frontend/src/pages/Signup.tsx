import { SignUp } from "@clerk/react";
import { AuthLayout } from "../components/auth/AuthLayout";

export default function Signup() {
  return (
    <AuthLayout>
      <SignUp routing="path" path="/signup" signInUrl="/login" fallbackRedirectUrl="/app" />
    </AuthLayout>
  );
}