import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../src/api/client";
import { AuthPage } from "../src/pages/AuthPage";

const authRequests = vi.hoisted(() => ({
  login: vi.fn(),
  signup: vi.fn(),
}));

vi.mock("../src/api/auth", () => authRequests);
vi.mock("../src/auth/AuthContext", () => ({
  useAuth: () => ({
    user: null,
    finishAuthentication: vi.fn(),
  }),
}));

describe("authentication page errors", () => {
  beforeEach(() => {
    authRequests.login.mockReset();
    authRequests.signup.mockReset();
  });

  it("shows signup-specific recovery guidance for an unreachable deployment", async () => {
    authRequests.signup.mockRejectedValue(new ApiError({
      code: "NETWORK_ERROR",
      message: "Could not confirm the save.",
    }));

    render(
      <MemoryRouter>
        <AuthPage mode="signup" />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "person@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Before retrying signup, try signing in",
    );
  });

  it("shows a login-specific availability message for an unreachable deployment", async () => {
    authRequests.login.mockRejectedValue(new ApiError({
      code: "NETWORK_ERROR",
      message: "Could not confirm the save.",
    }));

    render(
      <MemoryRouter>
        <AuthPage mode="login" />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "person@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "authentication service could not be reached",
    );
  });
});
