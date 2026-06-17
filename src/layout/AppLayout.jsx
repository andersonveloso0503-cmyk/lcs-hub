import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  Instagram,
  Users,
  Search,
  LogOut,
} from "lucide-react";
import { useAuth } from "../context/useAuth";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/crm", label: "CRM", icon: Users },
  { to: "/instagram", label: "Instagram", icon: Instagram },
  { to: "/google-ads", label: "Google Ads", icon: Search },
];

export default function AppLayout() {
  const { logout } = useAuth();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          LCS <span>Hub</span>
        </div>
        <span className="topbar-badge">Dados em tempo real</span>
      </header>

      <div className="app-body">
        <nav className="sidebar">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                "nav-item" + (isActive ? " active" : "")
              }
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}

          <div className="sidebar-spacer" />

          <button className="nav-item logout" onClick={logout}>
            <LogOut size={18} />
            <span>Sair</span>
          </button>
        </nav>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
