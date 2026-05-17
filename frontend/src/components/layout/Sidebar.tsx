import { NavLink } from "react-router-dom";
import {
  Users,
  Tags,
  CalendarDays,
  Calendar,
  CalendarOff,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/schedule", label: "Schedule", icon: Sparkles },
  { to: "/people", label: "People", icon: Users },
  { to: "/labels", label: "Labels", icon: Tags },
  { to: "/events", label: "Events", icon: Calendar },
  { to: "/availability", label: "Availability", icon: CalendarOff },
];

export function Sidebar() {
  return (
    <aside className="w-56 border-r bg-card flex flex-col">
      <div className="h-14 px-4 flex items-center border-b">
        <CalendarDays className="size-5 text-primary" />
        <span className="ml-2 font-semibold tracking-tight">Orbit</span>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
              )
            }
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 text-xs text-muted-foreground border-t">
        Phase 1 · local dev
      </div>
    </aside>
  );
}
