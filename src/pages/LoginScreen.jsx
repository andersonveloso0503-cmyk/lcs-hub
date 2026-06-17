import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { Lock } from "lucide-react";

export default function LoginScreen() {
  const { login } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    const ok = login(password);
    if (!ok) {
      setError(true);
      setPassword("");
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-icon">
          <Lock size={22} />
        </div>
        <h1>LCS Hub</h1>
        <p>Painel unificado — CRM, Instagram e Google Ads</p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            placeholder="Senha de acesso"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(false);
            }}
            autoFocus
          />
          {error && <span className="login-error">Senha incorreta. Tente novamente.</span>}
          <button type="submit">Entrar</button>
        </form>
      </div>
    </div>
  );
}
