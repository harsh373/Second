import { useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { meQueryOptions } from "../../api/user.api";
import { ErrorState } from "../ui/ErrorState";
import { Spinner } from "../ui/Loading";

function FullPage({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center bg-paper">{children}</div>;
}

// Guards every signed-in page:
//  - signed out            -> /login
//  - signed in, not set up -> /onboarding
export function ProtectedRoute() {
  const { isLoaded, isSignedIn } = useAuth();
  const { pathname } = useLocation();
  const me = useQuery({ ...meQueryOptions, enabled: Boolean(isSignedIn) });

  if (!isLoaded) {
    return (
      <FullPage>
        <Spinner />
      </FullPage>
    );
  }

  if (!isSignedIn) return <Navigate to="/login" replace />;

  if (me.isPending) {
    return (
      <FullPage>
        <Spinner />
      </FullPage>
    );
  }

  if (me.isError) {
    return (
      <FullPage>
        <ErrorState
          title="Could not load your account"
          description={me.error.message}
          onRetry={() => void me.refetch()}
        />
      </FullPage>
    );
  }

  if (!me.data.onboarded && pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }

  return <Outlet />;
}