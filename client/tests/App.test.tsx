import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { App } from "../src/App";

describe("application routes", () => {
  it("renders the dashboard route and complete primary navigation", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", {
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
  });

  it("renders a useful not-found route", () => {
    render(
      <MemoryRouter initialEntries={["/not-implemented"]}>
        <App />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return home" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});
