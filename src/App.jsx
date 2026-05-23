import { BrowserRouter, Routes, Route } from "react-router-dom";
import ReporterApp from "./pages/ReporterApp";
import StudioDashboard from "./pages/StudioDashboard";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ReporterApp />} />
        <Route path="/reporter" element={<ReporterApp />} />
        <Route path="/studio" element={<StudioDashboard />} />
      </Routes>
    </BrowserRouter>
  );
}