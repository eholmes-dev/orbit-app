import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startSignIn } from "@/features/auth/useAuth";

export function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-md border rounded-lg bg-card p-8 shadow-sm space-y-6">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-6 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">Orbit</h1>
        </div>
        <div>
          <h2 className="text-lg font-medium">Sign in</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Use your Microsoft work account to manage scheduling and sync with
            Outlook.
          </p>
        </div>
        <Button className="w-full" onClick={startSignIn}>
          Sign in with Microsoft
        </Button>
        <p className="text-xs text-muted-foreground">
          First sign-in requests calendar permissions. Your administrator may
          have already granted these on behalf of the organization.
        </p>
      </div>
    </div>
  );
}
