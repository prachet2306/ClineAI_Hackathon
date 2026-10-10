// Upload screen (route "/"): title, short description, disclaimer, then the client-side upload form and preview.
import Link from "next/link";
import { ArrowRightIcon, GitCompareIcon, LanguagesIcon, ListChecksIcon, ShieldCheckIcon } from "lucide-react";
import { UploadScreen } from "@/components/upload-screen";
import { DISCLAIMER } from "@/lib/shared";

const FEATURES = [
  { icon: ListChecksIcon, title: "Clear risk flags", text: "Clauses worth asking about, explained simply." },
  { icon: LanguagesIcon, title: "Your language", text: "English, Hindi, Assamese, Bengali and more." },
  { icon: ShieldCheckIcon, title: "Checked quotes", text: "Every flag quotes the exact words in your document." },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-4 sm:p-6">
      <section className="flex flex-col gap-3 pt-2 sm:pt-6">
        <span className="w-fit rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground">
          Rental · Job offer · Loan · Legal notice
        </span>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Understand your agreement before you sign</h1>
        <p className="text-base text-muted-foreground">
          Upload a document to see its clauses, flagged concerns and questions to ask, in plain language.
        </p>
      </section>

      <ul className="grid gap-3 sm:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex gap-3 rounded-xl border bg-background p-3 sm:flex-col sm:gap-2">
            <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <div>
              <p className="text-sm font-medium">{title}</p>
              <p className="text-xs text-muted-foreground">{text}</p>
            </div>
          </li>
        ))}
      </ul>

      <UploadScreen />

      <Link
        href="/compare"
        className="group flex items-center gap-3 rounded-xl border bg-background p-4 transition-colors hover:bg-muted"
      >
        <GitCompareIcon className="size-5 shrink-0 text-primary" aria-hidden />
        <div className="flex-1">
          <p className="text-sm font-medium">Got a second version?</p>
          <p className="text-xs text-muted-foreground">Compare two versions and spot quiet changes.</p>
        </div>
        <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>

      <p className="pb-4 text-center text-xs text-muted-foreground">{DISCLAIMER}</p>
    </main>
  );
}


