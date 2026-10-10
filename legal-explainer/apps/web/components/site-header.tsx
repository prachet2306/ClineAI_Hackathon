// Sticky top bar with brand and main navigation, shown on every page.
import Link from "next/link";
import { ScaleIcon } from "lucide-react";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ScaleIcon className="size-4" aria-hidden />
          </span>
          <span className="hidden sm:inline">Legal Document Explainer</span>
          <span className="sm:hidden">Explainer</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/" className="rounded-md px-3 py-2 hover:bg-muted">Check</Link>
          <Link href="/compare" className="rounded-md px-3 py-2 hover:bg-muted">Compare</Link>
          <Link href="/report" className="rounded-md px-3 py-2 hover:bg-muted">Report</Link>
        </nav>
      </div>
    </header>
  );
}
