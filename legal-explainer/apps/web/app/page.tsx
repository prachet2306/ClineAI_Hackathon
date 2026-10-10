// Upload screen (route "/"): title, short description, disclaimer, then the client-side upload form and preview.
import { UploadScreen } from "@/components/upload-screen";
import { DISCLAIMER } from "@/lib/shared";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Legal Document Explainer</h1>
        <p className="text-sm text-muted-foreground">
          Upload a rental agreement to see its clauses and get a simple, plain-language risk check.
        </p>
        <p className="text-xs text-muted-foreground">{DISCLAIMER}</p>
      </header>
      <UploadScreen />
    </main>
  );
}


