// Landing page placeholder. Proves the shared schemas import works and shadcn/ui renders.
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DISCLAIMER } from "@/lib/shared";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Legal Document Explainer</CardTitle>
          <CardDescription>
            Upload a rental agreement to get a simple risk report.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Button disabled>Upload coming soon</Button>
          <p className="text-sm text-muted-foreground">{DISCLAIMER}</p>
        </CardContent>
      </Card>
    </main>
  );
}

