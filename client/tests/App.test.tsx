import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { App } from "../src/App";
import { AuthProvider } from "../src/auth/AuthContext";

vi.mock("../src/api/auth", () => ({
  currentSession: async () => ({ id: "user-1", email: "person@example.com" }),
  logout: async () => undefined,
}));

vi.mock("../src/api/profile", () => ({
  getProfile: async () => ({
    display_name: "Personal user",
    timezone: "Asia/Kolkata",
    today: "2026-09-12",
    week_start: "2026-09-07",
    week_end: "2026-09-13",
  }),
  updateProfileDisplayName: async (displayName: string) => ({
    display_name: displayName.trim(),
    timezone: "Asia/Kolkata",
    today: "2026-09-12",
    week_start: "2026-09-07",
    week_end: "2026-09-13",
  }),
}));

describe("application routes", () => {
  it("renders the dashboard route and complete primary navigation", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AuthProvider><App /></AuthProvider>
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Your nutrition week, in context.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Meals" })).toHaveAttribute(
      "href",
      "/meals",
    );
    expect(screen.getAllByRole("link", { name: "Goals" })[0]).toHaveAttribute(
      "href",
      "/goals",
    );
    expect(screen.getAllByRole("link", { name: "Reports" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /image|login/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Logout" })).not.toBeInTheDocument();
  });

  it("updates the profile name and shows it as the rightmost account link", async () => {
    render(
      <MemoryRouter initialEntries={["/profile"]}>
        <AuthProvider><App /></AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Profile settings" })).toBeInTheDocument();
    const name = await screen.findByRole("textbox", { name: /display name/i });
    fireEvent.change(name, { target: { value: "Rakesh Naidu" } });
    expect(screen.getAllByText("person@example.com").length).toBeGreaterThan(0);
    expect(screen.getByText("Asia/Kolkata")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Profile name saved.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Rakesh Naidu" })).toHaveAttribute("href", "/profile");
  });

  it("renders a useful not-found route", async () => {
    render(
      <MemoryRouter initialEntries={["/not-implemented"]}>
        <AuthProvider><App /></AuthProvider>
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return home" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});
