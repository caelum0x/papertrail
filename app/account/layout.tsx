import type { ReactNode } from "react";
import { AccountNav } from "./_components/AccountNav";

// Account center layout: a persistent left rail (personal navigation) beside the
// active account page. Nested under the root layout, so the global NavBar/Footer
// still wrap this. Two-column on desktop, stacked on small screens.
export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="grid gap-8 md:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="md:sticky md:top-8 md:self-start">
          <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-ink/40">
            Account
          </p>
          <AccountNav />
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
