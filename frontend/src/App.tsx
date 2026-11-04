import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { Toaster } from "./components/ui/Toast";
import Desk from "./pages/Desk";
import Design from "./pages/Design";
import Landing from "./pages/Landing";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<AppShell />}>
          <Route index element={<Desk />} />
          <Route path="design" element={<Design />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Toaster />
    </>
  );
}