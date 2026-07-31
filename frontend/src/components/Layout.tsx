import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Activity,
  Archive,
  ArrowUpCircle,
  Bell,
  Bot,
  Boxes,
  Crown,
  FileText,
  Globe,
  CreditCard,
  KeyRound,
  KeySquare,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Monitor,
  ScrollText,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Terminal,
  type LucideIcon,
  Users as UsersIcon,
  Webhook as WebhookIcon,
  Workflow,
  X,
} from "lucide-react";
// Package/Building2 removidos: a área Admin virou um único item "Super Admin".
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import type { CurrentPlan } from "@/lib/types";
import { isMaxPlan, isTrial } from "@/lib/plans";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui";
import { PlanUpgradeDialog } from "@/components/PlanUpgradeDialog";
import { SetPasswordDialog } from "@/components/SetPasswordDialog";
import { TrialPromoDialog } from "@/components/TrialPromoDialog";
import logo from "@/logo.png";

interface NavItem {
  to: string;
  /** Chave em nav:items.* — o rótulo é traduzido no render. */
  key: string;
  icon: LucideIcon;
  end?: boolean;
  adminOnly?: boolean;
  masterOnly?: boolean;
}

// `key` de cada grupo vira nav:groups.<key>; a de cada item, nav:items.<key>.
const groups: { key: string; items: NavItem[] }[] = [
  {
    key: "overview",
    items: [
      { to: "/", key: "dashboard", icon: LayoutDashboard, end: true },
      { to: "/notifications", key: "notifications", icon: Bell },
      { to: "/devices", key: "devices", icon: Monitor },
      { to: "/sites", key: "sites", icon: MapPin },
      { to: "/racks", key: "racks", icon: Boxes },
    ],
  },
  {
    key: "actions",
    items: [
      { to: "/copilot", key: "copilot", icon: Bot },
      { to: "/commands", key: "commands", icon: Terminal },
      { to: "/templates", key: "templates", icon: FileText },
      { to: "/upgrades", key: "upgrades", icon: ArrowUpCircle },
      { to: "/scan", key: "scan", icon: Globe, masterOnly: true },
      { to: "/topology", key: "topology", icon: Workflow },
      { to: "/backups", key: "backups", icon: Archive },
      { to: "/logs", key: "logs", icon: ScrollText },
      { to: "/security", key: "security", icon: ShieldCheck },
    ],
  },
  {
    key: "fiberhome",
    items: [{ to: "/controllers", key: "controllers", icon: Server }],
  },
  {
    key: "admin",
    items: [
      { to: "/admin", key: "admin", icon: Crown, masterOnly: true },
    ],
  },
  {
    key: "system",
    items: [
      { to: "/activity", key: "activity", icon: Activity },
      { to: "/credentials", key: "credentials", icon: KeyRound },
      { to: "/users", key: "users", icon: UsersIcon, adminOnly: true },
      { to: "/apikeys", key: "apikeys", icon: KeySquare, adminOnly: true },
      { to: "/webhooks", key: "webhooks", icon: WebhookIcon, adminOnly: true },
      { to: "/settings", key: "settings", icon: Settings },
    ],
  },
];

export function Layout() {
  const { user, logout, refresh } = useAuth();
  const { t } = useTranslation();
  const toast = useToast();
  const initial = (user?.email ?? "?").charAt(0).toUpperCase();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [trialPromoOpen, setTrialPromoOpen] = useState(false);
  const [payWatching, setPayWatching] = useState(false);
  const [payValidating, setPayValidating] = useState(false);
  const [unread, setUnread] = useState(0);
  // Drawer da sidebar no mobile (<lg). Fecha ao trocar de rota.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setSidebarOpen(false), [location.pathname]);

  // Payment watcher: ao voltar do checkout, VALIDA a operação — consulta
  // /plans/current (que reconcilia ao vivo com o hub) até o plano ativar. Começa
  // com um overlay bloqueante "Validando operação" (~30s); se demorar mais, cai
  // para um banner discreto e segue observando em segundo plano (o poller do
  // backend cobre o resto). Cobre o caso do usuário estar com o app aberto.
  useEffect(() => {
    const pending = localStorage.getItem("aurora_pay_pending");
    // Só o admin de uma EMPRESA valida pagamento. Master (sem org, não paga) nunca
    // entra aqui — se houver flag antigo no navegador, limpa e sai.
    if (!user?.is_admin || user.role === "master" || user.org_id == null) {
      if (user?.role === "master") localStorage.removeItem("aurora_pay_pending");
      return;
    }
    if (!pending) return;
    const planId = Number(pending);
    setPayValidating(true);
    let tries = 0;
    const iv = window.setInterval(async () => {
      tries++;
      try {
        const cur = await api.get<CurrentPlan>("/plans/current"); // reconcilia ao vivo
        if (cur.plan_id === planId) {
          window.clearInterval(iv);
          localStorage.removeItem("aurora_pay_pending");
          setPayValidating(false);
          setPayWatching(false);
          toast.success(t("plans:paymentConfirmed"));
          void refresh(); // atualiza o plano no menu
          return;
        }
      } catch { /* ignora — tenta de novo */ }
      if (tries === 10) { // ~30s bloqueando → libera a tela e observa discreto
        setPayValidating(false);
        setPayWatching(true);
      }
      if (tries >= 60) { // ~3 min total
        window.clearInterval(iv);
        localStorage.removeItem("aurora_pay_pending");
        setPayValidating(false);
        setPayWatching(false);
      }
    }, 3000);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Plano é POR EMPRESA. QUALQUER usuário da empresa (não o Master) SEM PLANO ATIVO
  // (sem plano ou vencido) é BLOQUEADO por um popup INFECHÁVEL: o admin escolhe/paga
  // um plano; o operador vê só o aviso (não paga) e pode sair. Trial ATIVO → popup
  // dispensável só p/ o admin, 1x por sessão.
  const TRIAL_PROMO_KEY = "aurora_trial_promo_seen";
  const isOrgUser = !!user && user.role !== "master" && user.org_id != null;
  const isOrgAdmin = isOrgUser && !!user!.is_admin;
  const isTrialAdmin = isOrgAdmin && !!user!.plan && isTrial(user!.plan!);
  const needsPlan = isOrgUser && !!user!.needs_plan; // SEM PLANO ATIVO → bloqueia a empresa
  useEffect(() => {
    if (user?.must_set_password) return; // o popup de senha tem prioridade
    if (needsPlan) { setTrialPromoOpen(true); return; } // bloqueio infechável (empresa inteira)
    if (isTrialAdmin && !sessionStorage.getItem(TRIAL_PROMO_KEY)) {
      sessionStorage.setItem(TRIAL_PROMO_KEY, "1");
      setTrialPromoOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Contador de notificações não lidas: carrega no início, atualiza a cada 45s e
  // ao receber o evento "notifications:changed" (disparado ao ler na central).
  useEffect(() => {
    let alive = true;
    const load = () =>
      api.get<{ count: number }>("/notifications/unread-count").then((r) => alive && setUnread(r.count)).catch(() => {});
    load();
    const id = window.setInterval(load, 45000);
    const onChange = () => load();
    window.addEventListener("notifications:changed", onChange);
    return () => {
      alive = false;
      window.clearInterval(id);
      window.removeEventListener("notifications:changed", onChange);
    };
  }, []);

  return (
    <div className="flex min-h-screen">
      {/* Barra superior (mobile/tablet <lg): hambúrguer + marca */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/95 px-3 backdrop-blur lg:hidden">
        <button
          onClick={() => setSidebarOpen(true)}
          aria-label={t("nav:openMenu")}
          className="grid h-11 w-11 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text cursor-pointer"
        >
          <Menu className="h-5 w-5" />
        </button>
        <img src={logo} alt="" className="h-8 w-8 rounded-lg object-contain" />
        <p className="text-sm font-semibold leading-tight">
          Aurora Prisma <span className="bg-gradient-to-r from-primary via-cyan-400 to-accent bg-clip-text font-bold italic text-transparent">NetTools</span>
        </p>
      </header>

      {/* Backdrop do drawer (mobile) */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden" onClick={() => setSidebarOpen(false)} aria-hidden />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-screen w-[17rem] max-w-[85vw] shrink-0 flex-col border-r border-border bg-surface transition-transform duration-300 ease-out",
          "lg:sticky lg:top-0 lg:z-auto lg:w-60 lg:max-w-none lg:translate-x-0 lg:shadow-none",
          sidebarOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full",
        )}
      >
        <div className="flex items-center gap-2.5 px-5 py-5">
          <img src={logo} alt="Aurora Prisma NetTools" className="h-9 w-9 rounded-lg object-contain" />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight">
              Aurora Prisma{" "}
              <span className="bg-gradient-to-r from-primary via-cyan-400 to-accent bg-clip-text font-bold italic text-transparent">NetTools</span>
            </p>
            <p className="truncate text-xs text-muted">{t("nav:brand.tagline")}</p>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            aria-label={t("nav:closeMenu")}
            className="ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text cursor-pointer lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-2">
          {groups.map((group) => {
            const items = group.items.filter(
              (it) => (!it.adminOnly || user?.is_admin) && (!it.masterOnly || user?.role === "master"),
            );
            if (items.length === 0) return null;
            return (
              <div key={group.key}>
                <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted/70">
                  {t(`nav:groups.${group.key}`)}
                </p>
                <div className="space-y-0.5">
                  {items.map(({ to, key, icon: Icon, end }) => (
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
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="flex-1 truncate">{t(`nav:items.${key}`)}</span>
                    {key === "notifications" && unread > 0 && (
                      <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                  </NavLink>
                ))}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-border px-3 py-3.5">
          <div className="flex items-center gap-3">
            {user?.photo ? (
              <img src={user.photo} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
            ) : (
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-sm font-semibold text-primary">
                {initial}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium leading-tight">{user?.email}</p>
              <p className="mt-0.5 truncate text-xs leading-tight text-muted">
                {t(`common:roles.${user?.role === "master" ? "master" : user?.role === "admin" ? "admin" : "operator"}`)}
              </p>
            </div>
            <button
              onClick={logout}
              aria-label={t("nav:logout")}
              className="ml-1 shrink-0 rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-danger cursor-pointer transition-colors duration-200"
            >
              <LogOut className="h-4 w-4" aria-hidden />
            </button>
          </div>
          {user && user.role !== "master" && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium",
                  user.plan ? "bg-primary/15 text-primary" : "bg-surface-2 text-muted",
                )}
                title={t("nav:planLabel")}
              >
                <CreditCard className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{user.plan ?? t("nav:noPlan")}</span>
              </span>
              {user.is_admin && !(user.plan && isMaxPlan(user.plan)) && (
                <button
                  onClick={() => setUpgradeOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-gradient-to-r from-primary to-accent px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-110 cursor-pointer"
                >
                  <Sparkles className="h-3.5 w-3.5 shrink-0" />
                  {t("nav:upgradePlan")}
                </button>
              )}
            </div>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-x-hidden pt-14 lg:pt-0">
        <div className="h-0.5 bg-gradient-to-r from-primary/0 via-accent/60 to-primary/0" />
        <div className="px-4 py-5 sm:px-6 sm:py-6">
          <Outlet />
        </div>
      </main>

      {upgradeOpen && <PlanUpgradeDialog onClose={() => setUpgradeOpen(false)} />}
      {/* Admin em conta trial: vitrine de planos. Infechável se o trial venceu. */}
      {trialPromoOpen && (isTrialAdmin || needsPlan) && (
        <TrialPromoDialog
          expired={needsPlan}
          trial={isTrialAdmin}
          canPay={isOrgAdmin}
          onClose={() => setTrialPromoOpen(false)}
        />
      )}
      {/* Convidado sem senha: popup infechável para criar a senha. */}
      {user?.must_set_password && <SetPasswordDialog />}
      {/* Ao voltar do checkout: overlay bloqueante validando a operação (~30s). */}
      {payValidating && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-bg/80 backdrop-blur-sm">
          <div className="mx-4 flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border border-border bg-surface px-8 py-10 text-center shadow-xl">
            <Spinner className="h-9 w-9" />
            <div className="space-y-1.5">
              <p className="text-lg font-semibold text-text">{t("plans:paymentValidating")}</p>
              <p className="text-sm text-muted">{t("plans:paymentValidatingHint")}</p>
            </div>
          </div>
        </div>
      )}
      {/* Se a validação demora, segue observando o pagamento em segundo plano. */}
      {payWatching && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2.5 rounded-xl border border-border bg-surface px-4 py-3 shadow-lg">
          <Spinner className="h-4 w-4" />
          <span className="text-sm font-medium">{t("plans:paymentWatching")}</span>
        </div>
      )}
    </div>
  );
}
