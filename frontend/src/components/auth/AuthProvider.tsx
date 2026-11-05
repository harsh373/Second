import { useEffect, useRef, type ReactNode } from "react";
import { ClerkProvider, useAuth } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { setTokenGetter } from "../../api/client";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

if (!PUBLISHABLE_KEY) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY. Add it to frontend/.env and restart Vite.");
}

// Runs inside ClerkProvider: hands the token getter to axios and clears cached data on user change.
function AuthBridge({ children }: { children: ReactNode }) {
  const { getToken, userId } = useAuth();
  const queryClient = useQueryClient();
  const lastUserId = useRef<string | null>(null);

  // Assigned during render on purpose: child queries can fire before any effect would run.
  setTokenGetter(() => getToken());

  useEffect(() => {
    // Signing out or switching accounts must not leave the previous user's data cached.
    if (lastUserId.current && lastUserId.current !== userId) queryClient.clear();
    lastUserId.current = userId ?? null;
  }, [userId, queryClient]);

  return <>{children}</>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();

  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      afterSignOutUrl="/"
      appearance={{
        variables: { colorPrimary: "#254236", fontFamily: "Inter, system-ui, sans-serif", borderRadius: "0.5rem" },
      }}
    >
      <AuthBridge>{children}</AuthBridge>
    </ClerkProvider>
  );
}