import { NavLink } from "react-router-dom";
import {
  Users,
  Tags,
  Calendar,
  CalendarOff,
  CalendarCheck,
  Archive,
  BarChart3,
  Orbit as OrbitIcon,
  Moon,
  Sun,
  Monitor,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { UserMenu } from "./UserMenu";
import { useTheme, type ThemeMode } from "@/lib/theme";

const navItems = [
  { to: "/schedule", label: "Schedule", icon: CalendarCheck },
  { to: "/people", label: "People", icon: Users },
  { to: "/labels", label: "Labels", icon: Tags },
  { to: "/events", label: "Events", icon: Calendar },
  { to: "/availability", label: "Availability", icon: CalendarOff },
  { to: "/workload", label: "Workload", icon: BarChart3 },
  { to: "/archive", label: "Archive", icon: Archive },
];

export function Sidebar() {
  return (
    <aside className="w-56 border-r bg-sidebar flex flex-col">
      {/* Brand mark — orbital icon in a soft primary-tinted square, matches
          the reference's "logo glyph + wordmark" arrangement. */}
      <div className="h-14 px-4 flex items-center border-b gap-2.5">
        <span className="size-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <OrbitIcon className="size-4" />
        </span>
        <span className="font-semibold tracking-tight text-base">Orbit</span>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                // Pill-shaped nav items. Active item gets a soft primary
                // tint + colored icon so it reads as "selected" without
                // hurting at-a-glance scannability of the inactive list.
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )
            }
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}
      </nav>
      <ThemeToggle />
      <UserMenu />
    </aside>
  );
}

function ThemeToggle() {
  const { mode, setTheme } = useTheme();
  const opts: { value: ThemeMode; icon: typeof Sun; label: string }[] = [
    { value: "light", icon: Sun, label: "Light" },
    { value: "system", icon: Monitor, label: "System" },
    { value: "dark", icon: Moon, label: "Dark" },
  ];
  return (
    <div className="px-3 py-2 border-t">
      <div className="inline-flex w-full rounded-lg border bg-background p-0.5">
        {opts.map(({ value, icon: Icon, label }) => (
          <Button
            key={value}
            size="sm"
            variant="ghost"
            onClick={() => setTheme(value)}
            title={`${label} theme`}
            className={cn(
              "flex-1 h-7 px-0 rounded-md gap-0",
              mode === value
                ? "bg-primary/10 text-primary hover:bg-primary/15"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-pressed={mode === value}
            aria-label={`${label} theme`}
          >
            <Icon className="size-3.5" />
          </Button>
        ))}
      </div>
    </div>
  );
}
