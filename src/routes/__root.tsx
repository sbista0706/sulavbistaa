import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { ensureAnonymousSession } from "@/integrations/supabase/ensure-session";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-7xl text-foreground">404</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          That page doesn't exist.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Try again
          </button>
          <a href="/" className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-secondary">
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Property Pulse Check — Multifamily OM Risk Screening" },
      { name: "description", content: "Upload a multifamily Offering Memorandum and get a 5-rule risk screen with a pursue / pursue-with-conditions / pass recommendation." },
      { property: "og:title", content: "Property Pulse Check — Multifamily OM Risk Screening" },
      { property: "og:description", content: "Upload a multifamily Offering Memorandum and get a 5-rule risk screen with a pursue / pursue-with-conditions / pass recommendation." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Property Pulse Check — Multifamily OM Risk Screening" },
      { name: "twitter:description", content: "Upload a multifamily Offering Memorandum and get a 5-rule risk screen with a pursue / pursue-with-conditions / pass recommendation." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/65e867c6-8345-4d81-aaad-6eebf678b239/id-preview-b5ceaf66--5644d76e-59f4-4598-a9c8-3e9cc2114485.lovable.app-1782495524432.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/65e867c6-8345-4d81-aaad-6eebf678b239/id-preview-b5ceaf66--5644d76e-59f4-4598-a9c8-3e9cc2114485.lovable.app-1782495524432.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function AppHeader() {
  return (
    <header className="border-b border-border bg-surface/80 backdrop-blur sticky top-0 z-10">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <span className="font-display text-lg leading-none">L</span>
          </div>
          <div className="leading-tight">
            <div className="font-display text-xl">Ledger</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">OM Screening</div>
          </div>
        </Link>
        <nav className="flex items-center gap-1">
          <Link
            to="/"
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
            activeOptions={{ exact: true }}
            activeProps={{ className: "rounded-md px-3 py-1.5 text-sm bg-secondary text-foreground font-medium" }}
          >
            Dashboard
          </Link>
          <Link
            to="/compare"
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
            activeProps={{ className: "rounded-md px-3 py-1.5 text-sm bg-secondary text-foreground font-medium" }}
          >
            Compare
          </Link>
          <Link
            to="/upload"
            className="rounded-md bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Screen a deal
          </Link>
        </nav>
      </div>
    </header>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  // Give every visitor an anonymous Supabase session so owner-scoped RLS works.
  // If a session was just created, refetch any data loaded before it existed.
  useEffect(() => {
    let active = true;
    ensureAnonymousSession().then((created) => {
      if (active && created) queryClient.invalidateQueries();
    });
    return () => {
      active = false;
    };
  }, [queryClient]);

  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen flex flex-col">
        <AppHeader />
        <main key={pathname} className="flex-1 animate-in fade-in slide-in-from-bottom-1 duration-300 ease-out">
          <Outlet />
        </main>
        <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
          Ledger does not constitute investment advice. Always verify numbers against the source OM.
        </footer>
      </div>
    </QueryClientProvider>
  );
}
