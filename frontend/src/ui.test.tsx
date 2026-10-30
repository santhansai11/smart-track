// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Auth from "./Auth";
import { Rooms, CompetitionPage, RecoveryPage } from "./pages";
import { Modal } from "./components";
import type { Profile } from "./types";
vi.mock("./MapView", () => ({ default: () => <div aria-label="Route map" /> }));
vi.mock("./lib", async (importOriginal) => {
  const original = await importOriginal<typeof import("./lib")>();
  return { ...original, configured: false, supabase: null, api: vi.fn() };
});
import { api } from "./lib";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const student: Profile = {
  id: "student",
  full_name: "Alex Runner",
  role: "STUDENT",
  active: true,
};
function wrap(element: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>{element}</MemoryRouter>
    </QueryClientProvider>,
  );
}
describe("account and workflow screens", () => {
  it("invited sessions must choose and confirm a password", () => {
    wrap(<Auth passwordSetup hasSession />);
    expect(
      screen.getByRole("heading", { name: "Set your password." }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Confirm password")).toBeTruthy();
    expect(screen.queryByLabelText("Email address")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Create an account" }),
    ).toBeNull();
  });
  it("a reset URL without a session offers recovery rather than a broken update", () => {
    wrap(<Auth passwordSetup />);
    expect(
      screen.getByText(
        "Open a fresh password reset link from your email to set your password.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Forgot password?" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Update password" }),
    ).toBeNull();
  });
  it("shows setup honestly and does not simulate sign-in", () => {
    wrap(<Auth />);
    expect(
      screen.getByRole("button", { name: "Sign in" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByText("Your workspace is ready to connect")).toBeTruthy();
  });
  it("exposes name and confirmation only when registering", () => {
    wrap(<Auth />);
    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));
    expect(screen.getByLabelText("Full name")).toBeTruthy();
    expect(screen.getByLabelText("Confirm password")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
  it("offers password recovery without an admin registration option", () => {
    wrap(<Auth />);
    fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
    expect(
      screen.getByRole("button", { name: "Send reset link" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Full name")).toBeNull();
  });
  it("students join by code and cannot create rooms", async () => {
    vi.mocked(api).mockResolvedValue([]);
    wrap(<Rooms user={student} />);
    expect(
      await screen.findByText(
        "Your administrator will give you an invitation code. Join a room to start running.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Join with a code" }));
    expect(screen.getByLabelText("Invitation code")).toBeTruthy();
    expect(screen.queryByText("Create room")).toBeNull();
  });
  it("shows recovery decisions but students cannot approve", async () => {
    vi.mocked(api).mockResolvedValue([
      {
        id: "r",
        reason: "Accidental finish",
        status: "PENDING",
        full_name: "Alex Runner",
        room_name: "Morning crew",
        competition_id: "c",
        created_at: "2026-10-30T00:00:00Z",
      },
    ]);
    wrap(<RecoveryPage user={student} />);
    expect(await screen.findByText("Accidental finish")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
  it("root can review a pending recovery with a reason", async () => {
    vi.mocked(api).mockResolvedValue([
      {
        id: "r",
        reason: "Accidental finish",
        status: "PENDING",
        full_name: "Alex Runner",
        room_name: "Morning crew",
        competition_id: "c",
        created_at: "2026-10-30T00:00:00Z",
      },
    ]);
    wrap(<RecoveryPage user={{ ...student, role: "ROOT" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(screen.getByLabelText("Review note")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Confirm decision" }),
    ).toBeTruthy();
  });
  it("confirmation dialog has accessible controls", () => {
    wrap(
      <Modal open onOpenChange={() => {}} title="Ready to call it a run?">
        <button>Save & finish run</button>
        <button>Keep running</button>
      </Modal>,
    );
    expect(screen.getByRole("dialog").textContent).toContain(
      "Ready to call it a run?",
    );
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });
});
