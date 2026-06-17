import { useState } from "react";
import { AuthContext } from "./authContextDef";

const ADMIN_PASSWORD = "invictos2015"; // mesmo padrão usado nos outros apps LCS
const STORAGE_KEY = "lcs_hub_auth";

function readInitialAuth() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function AuthProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(readInitialAuth);

  function login(password) {
    if (password === ADMIN_PASSWORD) {
      localStorage.setItem(STORAGE_KEY, "true");
      setIsAuthenticated(true);
      return true;
    }
    return false;
  }

  function logout() {
    localStorage.removeItem(STORAGE_KEY);
    setIsAuthenticated(false);
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, loading: false, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
