import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { useAuth } from "./context/useAuth";
import LoginScreen from "./pages/LoginScreen";
import AppLayout from "./layout/AppLayout";
import Dashboard from "./pages/Dashboard";
import CRM from "./pages/CRM";
import InstagramModule from "./pages/InstagramModule";
import GoogleAdsModule from "./pages/GoogleAdsModule";
import GoogleAdsOptimizations from "./pages/GoogleAdsOptimizations";
import BlogGeneratorModule from "./pages/BlogGeneratorModule";
import "./App.css";

function Gate() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) return null;
  if (!isAuthenticated) return <LoginScreen />;

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="crm" element={<CRM />} />
        <Route path="instagram" element={<InstagramModule />} />
        <Route path="google-ads" element={<GoogleAdsModule />} />
        <Route path="google-ads/optimizations" element={<GoogleAdsOptimizations />} />
        <Route path="blog" element={<BlogGeneratorModule />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </BrowserRouter>
  );
}
