import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Building2, Plus, Users as UsersIcon } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import type { AppUser, CurrentPlan, OrgMeta } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Table, Td, Th } from "@/components/Table";
import { Badge, Button, EmptyState, Input, Modal, Select, Spinner } from "@/components/ui";
import { MaskedInput } from "@/components/MaskedInput";
import { ConfirmSwitch } from "@/components/ConfirmSwitch";
import { useConfirm } from "@/lib/confirm";
import { cn } from "@/lib/utils";

type Role = "operator" | "admin" | "master";
const roleOf = (u: AppUser): Role => (u.role as Role) ?? (u.is_admin ? "admin" : "operator");

// Empresa dona do usuário. Usuários do Master (org_id null) formam o balde "Sistema".
type CompanyKey = number | "system";
const companyKey = (u: AppUser): CompanyKey => u.org_id ?? "system";

type UserForm = { email: string; phone: string; role: Role; is_active: boolean };
const EMPTY_FORM: UserForm = { email: "", phone: "", role: "operator", is_active: true };

export function Users() {
  const { t } = useTranslation();
  const { alert } = useConfirm();
  const toast = useToast();
  const { user: me } = useAuth();
  const isMaster = me?.role === "master";
  const [items, setItems] = useState<AppUser[]>([]);
  const [orgs, setOrgs] = useState<OrgMeta[]>([]);       // Master: nomes/limites por empresa
  const [myPlan, setMyPlan] = useState<CurrentPlan | null>(null); // Admin: limite da própria empresa
  const [company, setCompany] = useState<CompanyKey | "all">("all");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [form, setForm] = useState<UserForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  function load() {
    setLoading(true);
    api.get<AppUser[]>("/users").then(setItems).finally(() => setLoading(false));
    if (isMaster) api.get<OrgMeta[]>("/admin/orgs").then(setOrgs).catch(() => {});
    else api.get<CurrentPlan>("/plans/current").then(setMyPlan).catch(() => {});
  }
  useEffect(load, [isMaster]);

  const orgName = useMemo(() => {
    const byId = new Map(orgs.map((o) => [o.id, o.name]));
    return (key: CompanyKey) => (key === "system" ? t("access:users.systemCompany") : byId.get(key) ?? `Org ${key}`);
  }, [orgs, t]);
  // Limite de usuários por empresa (do plano). "system" e sem plano → sem limite.
  const orgLimit = useMemo(() => {
    const byId = new Map(orgs.map((o) => [o.id, o.user_limit]));
    return (key: CompanyKey): number | null => (key === "system" ? null : byId.get(key) ?? null);
  }, [orgs]);

  // Empresas presentes (para o filtro do Master), com contagem, ordenadas por nome.
  const companyCounts = useMemo(() => {
    const c = new Map<CompanyKey, number>();
    for (const u of items) c.set(companyKey(u), (c.get(companyKey(u)) ?? 0) + 1);
    return [...c.entries()]
      .map(([key, n]) => ({ key, name: orgName(key), count: n }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items, orgName]);

  const filtered = useMemo(
    () => items.filter((u) => company === "all" || companyKey(u) === company),
    [items, company],
  );

  // Master: agrupa por empresa. Admin/operator: uma lista só (já escopada pela ORG).
  const companyGroups = useMemo(() => {
    const buckets = new Map<CompanyKey, AppUser[]>();
    for (const u of filtered) {
      const k = companyKey(u);
      (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(u);
    }
    return [...buckets.entries()]
      .map(([key, users]) => ({ key, name: orgName(key), users, limit: orgLimit(key) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filtered, orgName, orgLimit]);

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setErr("");
    setOpen(true);
  }
  function openEdit(u: AppUser) {
    setEditing(u);
    setForm({ email: u.email ?? "", phone: u.phone ?? "", role: roleOf(u), is_active: u.is_active ?? true });
    setErr("");
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    setErr("");
    try {
      if (editing) {
        // Sem senha aqui: cada usuário gerencia a própria senha. E-mail (login) não muda.
        const body: Record<string, unknown> = { role: form.role };
        if (form.phone !== (editing.phone ?? "")) body.phone = form.phone;
        if (form.is_active !== (editing.is_active ?? true)) body.is_active = form.is_active;
        await api.patch(`/users/${editing.id}`, body);
        setOpen(false);
        load();
      } else {
        // Criação SEM senha → convite por e-mail para o usuário definir a própria senha.
        // Telefone fica de fora: o usuário preenche o seu no Meu Perfil (Settings).
        await api.post("/users", { email: form.email, role: form.role, is_active: form.is_active });
        setOpen(false);
        load();
        toast.success(t("access:users.inviteSent", { email: form.email }));
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  // Ativa/desativa via a API existente (PATCH is_active); atualiza a lista no lugar.
  async function toggleActive(u: AppUser, next: boolean) {
    try {
      await api.patch(`/users/${u.id}`, { is_active: next });
      setItems((list) => list.map((x) => (x.id === u.id ? { ...x, is_active: next } : x)));
    } catch (e) {
      await alert({ title: t("access:errorTitle"), message: e instanceof ApiError ? e.message : String(e), tone: "danger" });
      throw e; // sinaliza o erro ao ConfirmSwitch (mantém o estado anterior)
    }
  }

  // Papéis que o ator pode atribuir (Master só por Master).
  const roleOptions: Role[] = isMaster ? ["operator", "admin", "master"] : ["operator", "admin"];

  const renderTable = (users: AppUser[]) => (
    <Table head={<><Th>{t("access:users.columns.email")}</Th><Th>{t("access:users.columns.phone")}</Th><Th>{t("access:users.columns.role")}</Th><Th>{t("access:users.columns.status")}</Th><Th className="text-right">{t("common:labels.actions")}</Th></>}>
      {users.map((u) => {
        const r = roleOf(u);
        const active = u.is_active ?? true;
        return (
          <tr key={u.id} className="hover:bg-surface-2 transition-colors duration-200">
            <Td className="font-medium">
              {u.email || <span className="text-danger/70">{t("access:users.noEmail")}</span>} {u.id === me?.id && <Badge tone="muted">{t("access:users.you")}</Badge>}
            </Td>
            <Td className="font-mono text-muted">{u.phone || "—"}</Td>
            <Td><Badge tone={r === "master" ? "accent" : r === "admin" ? "primary" : "muted"}>{t(`common:roles.${r}`)}</Badge></Td>
            <Td>
              <div className="flex items-center gap-2">
                <ConfirmSwitch
                  checked={active}
                  disabled={u.id === me?.id}
                  ariaLabel={t("access:users.toggle.aria")}
                  confirmTitle={(next) => t(next ? "access:users.toggle.activateTitle" : "access:users.toggle.deactivateTitle")}
                  confirmMessage={(next) => t(next ? "access:users.toggle.activateMsg" : "access:users.toggle.deactivateMsg", { name: u.email ?? "" })}
                  onToggle={(next) => toggleActive(u, next)}
                />
                <span className={cn("text-xs", active ? "text-muted" : "text-danger")}>
                  {t(active ? "access:users.statusActive" : "access:users.statusInactive")}
                </span>
              </div>
            </Td>
            <Td className="text-right">
              <Button variant="ghost" onClick={() => openEdit(u)}>{t("common:actions.edit")}</Button>
            </Td>
          </tr>
        );
      })}
    </Table>
  );

  return (
    <div>
      <PageHeader
        title={t("access:users.title")}
        subtitle={t("access:users.subtitle")}
        actions={<Button onClick={openNew}><Plus className="h-4 w-4" /> {t("access:users.add")}</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {isMaster ? (
          <Select
            value={String(company)}
            onChange={(e) => setCompany(e.target.value === "all" ? "all" : e.target.value === "system" ? "system" : Number(e.target.value))}
            className="w-56"
            aria-label={t("access:users.companyFilter")}
          >
            <option value="all">{t("access:users.allCompanies")}</option>
            {companyCounts.map((c) => (
              <option key={c.key} value={String(c.key)}>{c.name} ({c.count})</option>
            ))}
          </Select>
        ) : (
          // Admin: limite de usuários da própria empresa.
          myPlan?.has_org && <UserLimitBadge used={filtered.length} limit={myPlan.max_users} />
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
      ) : filtered.length === 0 ? (
        <EmptyState title={t("access:users.empty")} />
      ) : isMaster ? (
        // Master: uma seção por empresa, com o limite de usuários de cada uma.
        <div className="space-y-8">
          {companyGroups.map((g) => (
            <section key={g.key}>
              <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-border pb-2">
                <Building2 className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">{g.name}</h2>
                <UserLimitBadge used={g.users.length} limit={g.limit} />
              </div>
              {renderTable(g.users)}
            </section>
          ))}
        </div>
      ) : (
        renderTable(filtered)
      )}

      {open && (
        <Modal
          title={editing ? t("access:users.editTitle", { name: editing.email ?? "" }) : t("access:users.add")}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>{t("common:actions.cancel")}</Button>
              <Button onClick={save} disabled={saving || (!editing && !form.email)}>
                {saving ? t("common:actions.saving") : editing ? t("common:actions.save") : t("access:users.sendInvite")}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <Fld label={t("access:users.emailLabel")}>
              {/* E-mail é o login: editável só na criação. */}
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder={t("access:users.emailPlaceholder")} disabled={!!editing} autoFocus={!editing} />
            </Fld>
            {/* Telefone só na edição: na criação o usuário preenche o seu no Meu Perfil. */}
            {editing && (
              <Fld label={t("access:users.phoneLabel")}>
                <MaskedInput mask="phone" value={form.phone} onValueChange={(v) => setForm({ ...form, phone: v })} placeholder={t("access:users.phonePlaceholder")} className="font-mono" />
              </Fld>
            )}
            {!editing && (
              <p className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-[11px] text-muted">
                {t("access:users.inviteHint")}
              </p>
            )}
            <Fld label={t("access:users.roleLabel")}>
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {roleOptions.map((r) => <option key={r} value={r}>{t(`common:roles.${r}`)}</option>)}
                {/* mantém o papel atual visível mesmo que o ator não possa atribuí-lo */}
                {editing && !roleOptions.includes(form.role) && <option value={form.role}>{t(`common:roles.${form.role}`)}</option>}
              </Select>
            </Fld>
            {/* Conta ativa. Bloqueado para a própria conta (evita autolockout, igual ao back-end). */}
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 cursor-pointer accent-primary disabled:cursor-not-allowed"
                checked={form.is_active}
                disabled={editing?.id === me?.id}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              />
              <span>
                <span className="text-sm">{t("access:users.activeLabel")}</span>
                <span className="block text-[11px] text-muted">{t("access:users.activeHint")}</span>
              </span>
            </label>
            <p className="text-[11px] text-muted">
              <strong>{t("common:roles.operator")}</strong>: {t("access:users.roleHelp.operator")} <strong>{t("common:roles.admin")}</strong>: {t("access:users.roleHelp.admin")}
              {isMaster && <> <strong>{t("common:roles.master")}</strong>: {t("access:users.roleHelp.master")}</>}
            </p>
            {err && <p className="rounded-lg border border-danger/40 bg-danger/10 p-2 text-sm text-danger">{err}</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] uppercase tracking-wide text-muted">{label}</label>
      {children}
    </div>
  );
}

/** Badge "X/Y usuários" — âmbar perto do limite, vermelho ao atingir. limit null = sem limite. */
function UserLimitBadge({ used, limit }: { used: number; limit: number | null }) {
  const { t } = useTranslation();
  if (limit == null || limit <= 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-xs text-muted">
        <UsersIcon className="h-3.5 w-3.5" /> {t("access:users.limitCount", { used, limit: "∞" })}
      </span>
    );
  }
  const atLimit = used >= limit;
  const near = used / limit >= 0.8 && !atLimit;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium",
        atLimit ? "bg-danger/15 text-danger" : near ? "bg-accent/15 text-accent" : "bg-primary/15 text-primary",
      )}
    >
      <UsersIcon className="h-3.5 w-3.5" /> {t("access:users.limitCount", { used, limit })}
    </span>
  );
}
