// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import Auth from "./Auth";
const { oauth } = vi.hoisted(() => ({ oauth: vi.fn() }));
vi.mock("./lib", () => ({
  configured: true,
  authCallback: { passwordSetup: false, error: "" },
  supabase: { auth: { signInWithOAuth: oauth } },
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("starts Google sign-in without requiring email form fields", async () => {
  oauth.mockResolvedValue({ error: null });
  render(<Auth />);
  fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
  await waitFor(() =>
    expect(oauth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
        queryParams: { prompt: "select_account" },
      },
    }),
  );
  expect(
    screen
      .getByRole("button", { name: "Opening Google…" })
      .hasAttribute("disabled"),
  ).toBe(true);
});
it("offers Google on registration and permits retry after an error", async () => {
  oauth.mockResolvedValue({ error: new Error("provider failure") });
  render(<Auth />);
  fireEvent.click(screen.getByRole("button", { name: "Create an account" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
  expect(
    await screen.findByText(/Google sign-in could not start/),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "Continue with Google" })
      .hasAttribute("disabled"),
  ).toBe(false);
});
it("keeps password setup separate from Google sign-in", () => {
  render(<Auth passwordSetup hasSession />);
  expect(
    screen.queryByRole("button", { name: "Continue with Google" }),
  ).toBeNull();
});
