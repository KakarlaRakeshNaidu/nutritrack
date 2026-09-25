import { Link, NavLink, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { RequireAuth } from "./auth/RequireAuth";

import { Goals } from "./pages/Goals";
import { Home } from "./pages/Home";
import { MealEditor } from "./pages/MealEditor";
import { MealFromImage } from "./pages/MealFromImage";
import { MealHistory } from "./pages/MealHistory";
import { NotFound } from "./pages/NotFound";
import { Reports } from "./pages/Reports";
import { Profile } from "./pages/Profile";
import { AuthPage } from "./pages/AuthPage";
import { Chat } from "./pages/Chat";

function AppLayout() {
  const { user, displayName } = useAuth();
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
          <NavLink to="/chat">Chat</NavLink>
          <NavLink className="nav-user" to="/profile" title={displayName ?? user?.email}>
            {displayName ?? user?.email}
          </NavLink>
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
      <Route path="login" element={<AuthPage mode="login" />} />
      <Route path="signup" element={<AuthPage mode="signup" />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
        <Route index element={<Home />} />
        <Route path="meals" element={<MealHistory />} />
        <Route path="meals/new" element={<MealEditor />} />
        <Route path="meals/from-image" element={<MealFromImage />} />
        <Route path="meals/:id/edit" element={<MealEditor />} />
        <Route path="goals" element={<Goals />} />
        <Route path="reports" element={<Reports />} />
        <Route path="chat" element={<Chat />} />
        <Route path="profile" element={<Profile />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
