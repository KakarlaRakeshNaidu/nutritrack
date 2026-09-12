import { Route, Routes } from "react-router-dom";

function HomePage() {
  return (
    <main className="page-shell">
      <section className="intro" aria-labelledby="page-title">
        <p className="eyebrow">Nutrition diary foundation</p>
        <h1 id="page-title">Personal Calorie Tracker</h1>
        <p className="description">
          A focused space for recording meals and understanding nutrition. The
          application foundation is ready; diary and reporting workflows will
          be added in later phases.
        </p>
      </section>
    </main>
  );
}

export function App() {
  // Routes are present from the foundation onward so future pages can be added
  // without changing how the application is mounted or tested.
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
    </Routes>
  );
}
