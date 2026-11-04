import { Link } from "react-router-dom";
import { ArrowRight, Brain, CheckCheck, Eye, FolderKanban, Lightbulb, MessageSquareShare } from "lucide-react";
import { buttonClasses } from "../components/ui/Button";

const responsibilities = [
  { icon: Brain, title: "Understand", text: "Knows you, your preferences, goals and the people around you." },
  { icon: Eye, title: "Observe", text: "Stays aware of what is happening across your inbox and calendar." },
  { icon: FolderKanban, title: "Organize", text: "Keeps matters, commitments and information in order." },
  { icon: Lightbulb, title: "Anticipate", text: "Surfaces what needs attention before you have to ask." },
  { icon: MessageSquareShare, title: "Represent", text: "Communicates and acts for you, within limits you set." },
  { icon: CheckCheck, title: "Follow through", text: "Keeps going until a responsibility is verifiably done." },
];

export default function Landing() {
  return (
    <div className="min-h-dvh bg-paper">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-6 sm:px-8">
        <span className="font-display text-2xl tracking-tight">Second</span>
        <Link to="/app" className={buttonClasses("secondary", "sm")}>
          Open Second
        </Link>
      </header>

      <main>
        <section className="mx-auto max-w-5xl px-5 pt-16 pb-20 sm:px-8 sm:pt-24">
          <p className="animate-rise text-sm font-medium tracking-wide text-accent uppercase">
            For students and independent builders
          </p>
          <h1 className="mt-4 max-w-3xl animate-rise font-display text-5xl leading-[1.05] tracking-tight [animation-delay:80ms] sm:text-7xl">
            Your personal AI secretary.
          </h1>
          <p className="mt-6 max-w-xl animate-rise text-lg text-ink-muted [animation-delay:160ms]">
            Second takes care of the things you would otherwise keep taking care of yourself, and makes sure
            they actually get finished.
          </p>
          <div className="mt-10 animate-rise [animation-delay:240ms]">
            <Link to="/app" className={buttonClasses("primary", "lg")}>
              Enter the office
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </section>

        <section className="border-t border-line bg-surface">
          <div className="mx-auto max-w-5xl px-5 py-16 sm:px-8">
            <h2 className="font-display text-3xl tracking-tight">Six responsibilities, one secretary</h2>
            <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {responsibilities.map(({ icon: Icon, title, text }) => (
                <div key={title}>
                  <div className="flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <Icon className="size-5" aria-hidden />
                  </div>
                  <h3 className="mt-4 font-medium">{title}</h3>
                  <p className="mt-1 text-sm text-ink-muted">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-5xl px-5 py-8 text-sm text-ink-muted sm:px-8">
        © {new Date().getFullYear()} Second
      </footer>
    </div>
  );
}