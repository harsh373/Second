import { Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { AppShell } from "./components/layout/AppShell";
import { Toaster } from "./components/ui/Toast";
import Desk from "./pages/Desk";
import Design from "./pages/Design";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import Onboarding from "./pages/Onboarding";
import Signup from "./pages/Signup";

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Landing />} />
        {/* The /* lets Clerk use sub-paths like /login/factor-one */}
        <Route path="/login/*" element={<Login />} />
        <Route path="/signup/*" element={<Signup />} />

        <Route element={<ProtectedRoute />}>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/app" element={<AppShell />}>
            <Route index element={<Desk />} />
            <Route path="design" element={<Design />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
      <Toaster />
    </>
  );
}