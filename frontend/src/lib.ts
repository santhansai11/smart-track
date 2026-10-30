import { createClient } from "@supabase/supabase-js";
import { create } from "zustand";
import { readAuthCallback } from "./authCallback";
export const authCallback = readAuthCallback(
  typeof window === "undefined"
    ? { hash: "", search: "", pathname: "/" }
    : window.location,
);
export const configured = Boolean(
  import.meta.env.VITE_SUPABASE_URL &&
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
export const supabase = configured
  ? createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    )
  : null;
export const useNotice = create<{
  message: string;
  set: (message: string) => void;
}>((set) => ({ message: "", set: (message) => set({ message }) }));
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const session = await supabase?.auth.getSession();
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api/v1"}${path}`,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.data.session?.access_token || ""}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      typeof result.detail === "string"
        ? result.detail
        : result.detail?.map((e: { msg: string }) => e.msg).join(". ") ||
            "Request failed",
    );
  return result;
}
export const km = (m: number) => (m / 1000).toFixed(2);
export const duration = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ":" : ""}${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
export const date = (s: string) =>
  new Date(s).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
