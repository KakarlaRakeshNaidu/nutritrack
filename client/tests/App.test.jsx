import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { App } from "../src/App.jsx";

describe("root route", () => {
  it("renders the truthful product introduction through the router", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Personal Calorie Tracker" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/diary and reporting workflows will be added in later phases/i),
    ).toBeInTheDocument();
  });
});
