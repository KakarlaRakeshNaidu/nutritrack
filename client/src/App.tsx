import { Link, NavLink, Outlet, Route, Routes } from "react-router-dom";

import { Goals } from "./pages/Goals";
import { Home } from "./pages/Home";
import { MealEditor } from "./pages/MealEditor";
import { MealHistory } from "./pages/MealHistory";
import { NotFound } from "./pages/NotFound";
import { Reports } from "./pages/Reports";

function AppLayout() {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="site-header">
        <Link className="brand" to="/" aria-label="NutriTrack home">
          <span className="brand-mark" aria-hidden="true">
            N
          </span>
          <span>NutriTrack</span>
        </Link>
        <nav className="site-nav" aria-label="Primary navigation">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/meals">Meals</NavLink>
          <NavLink to="/goals">Goals</NavLink>
          <NavLink to="/reports">Reports</NavLink>
        </nav>
      </header>
      <div id="main-content">
        <Outlet />
      </div>
      <footer className="site-footer">
        <p>Personal nutrition diary  -  Current targets, clearly recorded</p>
      </footer>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Home />} />
        <Route path="meals" element={<MealHistory />} />
        <Route path="meals/new" element={<MealEditor />} />
        <Route path="meals/:id/edit" element={<MealEditor />} />
        <Route path="goals" element={<Goals />} />
        <Route path="reports" element={<Reports />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
