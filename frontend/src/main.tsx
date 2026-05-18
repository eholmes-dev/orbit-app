import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import "./index.css";
import App from "./App.tsx";
import { bootstrapTheme } from "@/lib/theme";

// Apply the persisted theme before React paints so the first frame uses the
// right palette — avoids the white-flash on dark-mode page loads.
bootstrapTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      // Treat data as fresh for 30s. Without this, every nav back to a page
      // refetches all its queries — Schedule is the worst offender (events,
      // people, availability, assignments). Mutations still invalidate
      // explicitly, so user-driven changes still appear immediately.
      staleTime: 30_000,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  </StrictMode>,
);
