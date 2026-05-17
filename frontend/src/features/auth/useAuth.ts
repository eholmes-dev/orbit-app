import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

interface MeResponse {
  user: AuthUser | null;
}

const KEY = ["auth", "me"] as const;
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export function useAuth() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get<MeResponse>("/api/auth/me"),
    staleTime: 60_000,
  });
}

/** Full-page redirect to the backend's login endpoint, which kicks off OAuth. */
export function startSignIn() {
  window.location.href = `${API_URL}/api/auth/login`;
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>("/api/auth/logout", {}),
    onSuccess: () => {
      qc.setQueryData(KEY, { user: null });
      qc.clear();
    },
  });
}
