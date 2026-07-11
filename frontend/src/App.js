import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "@/App.css";
import { Toaster } from "sonner";
import SecretaryPage from "@/pages/SecretaryPage";
import DoctorPage from "@/pages/DoctorPage";
import LoginPage from "@/pages/LoginPage";
import RecordsPage from "@/pages/RecordsPage";
import ProtectedRoute from "@/components/ProtectedRoute";

function App() {
  return (
    <div className="App">
      <Toaster position="top-center" richColors />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/secretary" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/secretary"
            element={
              <ProtectedRoute>
                <SecretaryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/doctor"
            element={
              <ProtectedRoute>
                <DoctorPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/records"
            element={
              <ProtectedRoute>
                <RecordsPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;
