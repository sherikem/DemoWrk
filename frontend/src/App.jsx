// frontend/src/App.jsx
// Shows the login page until someone signs in, then the dashboard with only
// the tabs their role allows (see auth/AuthContext.jsx).
import Dashboard from "./pages/Dashboard";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import LoginPage from "./auth/LoginPage";

function Gate() {
  const { user, loading } = useAuth();
  if (loading) return null;          // checking a stored session; avoids a login-page flash
  return user ? <Dashboard /> : <LoginPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
