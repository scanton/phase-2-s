import { Routes, Route } from "react-router-dom";
import Sidebar from "./components/Sidebar.tsx";
import RunsPage from "./pages/RunsPage.tsx";
import RunDetailPage from "./pages/RunDetailPage.tsx";

export default function App() {
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <a href="#main" className="skip-link">Skip to content</a>
      <Sidebar />
      <main id="main" style={{ flex: 1, padding: "24px", overflowX: "auto" }}>
        <Routes>
          <Route path="/" element={<RunsPage />} />
          <Route path="/runs/:id" element={<RunDetailPage />} />
        </Routes>
      </main>
    </div>
  );
}
