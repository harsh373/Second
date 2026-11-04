import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-paper">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="lg:pl-64">
        <Header onMenuClick={() => setNavOpen(true)} />
        <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}