import { Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { AppShell } from "./components/layout/AppShell";
import { Toaster } from "./components/ui/Toast";
import Chat from "./pages/Chat";
import Commitments from "./pages/Commitments";
import Desk from "./pages/Desk";
import Design from "./pages/Design";
import GoogleDebug from "./pages/GoogleDebug";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Memory from "./pages/Memory";
import NotFound from "./pages/NotFound";
import Onboarding from "./pages/Onboarding";
import OpenLoops from "./pages/OpenLoops";
import People from "./pages/People";
import Settings from "./pages/Settings";
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
            <Route path="chat/:conversationId?" element={<Chat />} />
            <Route path="commitments" element={<Commitments />} />
            <Route path="open-loops" element={<OpenLoops />} />
            <Route path="people" element={<People />} />
            <Route path="memory" element={<Memory />} />
            <Route path="settings" element={<Settings />} />
            <Route path="design" element={<Design />} />
            {import.meta.env.DEV && <Route path="dev/google" element={<GoogleDebug />} />}
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
      <Toaster />
    </>
  );
}