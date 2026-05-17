import { Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { Shell } from "@/components/layout/Shell";
import { PeoplePage } from "@/pages/PeoplePage";
import { LabelsPage } from "@/pages/LabelsPage";
import { EventsPage } from "@/pages/EventsPage";
import { AvailabilityPage } from "@/pages/AvailabilityPage";
import { SchedulePage } from "@/pages/SchedulePage";
import { LoginPage } from "@/pages/LoginPage";
import { useAuth } from "@/features/auth/useAuth";

function RequireAuth() {
  const { data, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }
  if (!data?.user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Shell />}>
          <Route index element={<Navigate to="/schedule" replace />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/people" element={<PeoplePage />} />
          <Route path="/labels" element={<LabelsPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/availability" element={<AvailabilityPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
