import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth, useLogout } from "@/features/auth/useAuth";

export function UserMenu() {
  const { data } = useAuth();
  const logout = useLogout();
  const user = data?.user;

  if (!user) return null;

  const handleLogout = async () => {
    try {
      await logout.mutateAsync();
      window.location.href = "/login";
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Logout failed");
    }
  };

  return (
    <div className="p-3 border-t flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{user.name}</div>
        <div className="text-xs text-muted-foreground truncate">{user.email}</div>
      </div>
      <Button
        size="icon"
        variant="ghost"
        title="Sign out"
        onClick={handleLogout}
        disabled={logout.isPending}
      >
        <LogOut className="size-4" />
      </Button>
    </div>
  );
}
