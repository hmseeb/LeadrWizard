import { Suspense } from "react";
import { OnboardClient } from "./onboard-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Onboarding | LeadrWizard",
  description: "Complete your LeadrWizard onboarding",
};

export default function OnboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-zinc-950">
          <div className="text-zinc-400">Loading...</div>
        </div>
      }
    >
      <OnboardClient />
    </Suspense>
  );
}
