import { Routes, Route } from "react-router-dom";
import { useState } from "react";
import Sidebar from "./components/Sidebar.tsx";
import RunsPage from "./pages/RunsPage.tsx";
import RunDetailPage from "./pages/RunDetailPage.tsx";
import ConfigPage from "./pages/ConfigPage.tsx";
import NewRunPage from "./pages/NewRunPage.tsx";
import { useTheme } from "./hooks/useTheme.ts";

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useTheme(); // Apply theme to <html> data-theme attribute

  return (
    <div className="app-layout">
      <a href="#main" className="skip-link">Skip to content</a>
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div
        className={`sidebar-overlay${sidebarOpen ? " sidebar-open" : ""}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />
      <main id="main" style={{ flex: 1, padding: "24px", overflowX: "auto", minWidth: 0 }}>
        <button
          className="hamburger-btn"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={sidebarOpen}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <rect y="2" width="18" height="2" rx="1" fill="currentColor"/>
            <rect y="8" width="18" height="2" rx="1" fill="currentColor"/>
            <rect y="14" width="18" height="2" rx="1" fill="currentColor"/>
          </svg>
        </button>
        <Routes>
          <Route path="/" element={<RunsPage />} />
          <Route path="/runs/new" element={<NewRunPage />} />
          <Route path="/runs/:id" element={<RunDetailPage />} />
          <Route path="/config" element={<ConfigPage />} />
        </Routes>
      </main>
    </div>
  );
}
