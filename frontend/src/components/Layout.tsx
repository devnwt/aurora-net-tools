import { NavLink, Outlet } from "react-router-dom";
import {
  Activity,
  Archive,
  ArrowUpCircle,
  Bot,
  Boxes,
  Crown,
  FileText,
  Globe,
  KeyRound,
  KeySquare,
  LayoutDashboard,
  LogOut,
  MapPin,
  Monitor,
  ScrollText,
  Server,
  Settings,
  ShieldCheck,
  Terminal,
  type LucideIcon,
  Users as UsersIcon,
  Webhook as WebhookIcon,
  Workflow,
} from "lucide-react";
// Package/Building2 removidos: a área Admin virou um único item "Super Admin".
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import logo from "@/logo.png";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  adminOnly?: boolean;
  masterOnly?: boolean;
}

const groups: { title: string; items: NavItem[] }[] = [
  {
    title: "VISÃO GERAL",
    items: [
      { to: "/", label: "Painel", icon: LayoutDashboard, end: true },
      { to: "/devices", label: "Dispositivos", icon: Monitor },
      { to: "/sites", label: "Sites", icon: MapPin },
      { to: "/racks", label: "Racks e Mapa", icon: Boxes },
    ],
  },
  {
    title: "AÇÕES",
    items: [
      { to: "/copilot", label: "Copilot", icon: Bot },
      { to: "/commands", label: "Comandos", icon: Terminal },
      { to: "/templates", label: "Modelos", icon: FileText },
      { to: "/upgrades", label: "Atualizações", icon: ArrowUpCircle },
      { to: "/scan", label: "Escanear Rede", icon: Globe },
      { to: "/topology", label: "Topologia", icon: Workflow },
      { to: "/backups", label: "Backups", icon: Archive },
      { to: "/logs", label: "Logs", icon: ScrollText },
      { to: "/security", label: "Segurança", icon: ShieldCheck },
    ],
  },
  {
    title: "FIBERHOME",
    items: [{ to: "/controllers", label: "Controladoras", icon: Server }],
  },
  {
    title: "ADMIN",
    items: [
      { to: "/admin", label: "Super Admin", icon: Crown, masterOnly: true },
    ],
  },
  {
    title: "SISTEMA",
    items: [
      { to: "/activity", label: "Atividade", icon: Activity },
      { to: "/credentials", label: "Credenciais", icon: KeyRound },
      { to: "/users", label: "Usuários", icon: UsersIcon, adminOnly: true },
      { to: "/apikeys", label: "Chaves de API", icon: KeySquare, adminOnly: true },
      { to: "/webhooks", label: "Webhooks", icon: WebhookIcon, adminOnly: true },
      { to: "/settings", label: "Configurações", icon: Settings },
    ],
  },
];

export function Layout() {
  const { user, logout } = useAuth();
  const initial = (user?.username ?? "?").charAt(0).toUpperCase();

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <img src={logo} alt="Aurora Prisma NetTools" className="h-9 w-9 rounded-lg object-contain" />
          <div>
            <p className="text-sm font-semibold leading-tight">
              Aurora Prisma{" "}
              <span className="bg-gradient-to-r from-primary via-cyan-400 to-accent bg-clip-text font-bold italic text-transparent">NetTools</span>
            </p>
            <p className="text-xs text-muted">Gerência de NOC</p>
          </div>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-2">
          {groups.map((group) => {
            const items = group.items.filter(
              (it) => (!it.adminOnly || user?.is_admin) && (!it.masterOnly || user?.role === "master"),
            );
            if (items.length === 0) return null;
            return (
              <div key={group.title}>
                <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted/70">
                  {group.title}
                </p>
                <div className="space-y-0.5">
                  {items.map(({ to, label, icon: Icon, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-200 cursor-pointer",
                        isActive
                          ? "bg-primary/15 text-primary"
                          : "text-muted hover:bg-surface-2 hover:text-text",
                      )
                    }
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {label}
                  </NavLink>
                ))}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-border px-3 py-3">
          <div className="flex items-center gap-3 px-2">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/15 text-sm font-semibold text-primary">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{user?.username}</p>
              <p className="text-xs text-muted">{user?.role === "master" ? "Master" : user?.role === "admin" ? "Administrador" : "Operador"}</p>
            </div>
            <button
              onClick={logout}
              aria-label="Sair"
              className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-danger cursor-pointer transition-colors duration-200"
            >
              <LogOut className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden">
        <div className="h-0.5 bg-gradient-to-r from-primary/0 via-accent/60 to-primary/0" />
        <div className="px-6 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
