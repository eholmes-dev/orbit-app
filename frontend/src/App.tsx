import { Routes, Route, Navigate } from "react-router-dom";
import { Shell } from "@/components/layout/Shell";
import { PeoplePage } from "@/pages/PeoplePage";
import { LabelsPage } from "@/pages/LabelsPage";
import { EventsPage } from "@/pages/EventsPage";
import { AvailabilityPage } from "@/pages/AvailabilityPage";
import { SchedulePage } from "@/pages/SchedulePage";

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Navigate to="/schedule" replace />} />
        <Route path="/schedule" element={<SchedulePage />} />
        <Route path="/people" element={<PeoplePage />} />
        <Route path="/labels" element={<LabelsPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/availability" element={<AvailabilityPage />} />
      </Route>
    </Routes>
  );
}
