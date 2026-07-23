import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { AppUser } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Table, Td, Th } from "@/components/Table";
import { Badge, Button, EmptyState, Input, Modal, Select, Spinner } from "@/components/ui";
import { useConfirm } from "@/lib/confirm";
import { PASSWORD_HINT_KEY, passwordError } from "@/lib/password";

type Role = "operator" | "admin" | "master";
const roleOf = (u: AppUser): Role => (u.role as Role) ?? (u.is_admin ? "admin" : "operator");

export function Users() {
  const { t } = useTranslation();
  const { confirm, alert } = useConfirm();
  const { user: me } = useAuth();
  const isMaster = me?.role === "master";
  const [items, setItems] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [form, setForm] = useState<{ username: string; email: string; password: string; role: Role }>({ username: "", email: "", password: "", role: "operator" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  function load() {
    setLoading(true);
    api.get<AppUser[]>("/users").then(setItems).finally(() => setLoading(false));
  }
  useEffect(load, []);

  function openNew() {
    setEditing(null);
    setForm({ username: "", email: "", password: "", role: "operator" });
    setErr("");
    setOpen(true);
  }
  function openEdit(u: AppUser) {
    setEditing(u);
    setForm({ username: u.username, email: u.email ?? "", password: "", role: roleOf(u) });
    setErr("");
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    setErr("");
    // Valida a política de senha (criar: obrigatória; editar: só se for trocar).
    if (!editing || form.password) {
      const pe = passwordError(form.password);
      if (pe) { setErr(t(pe)); setSaving(false); return; }
    }
    try {
      if (editing) {
        const body: Record<string, unknown> = { role: form.role };
        if (form.password) body.password = form.password;
        // Só envia e-mail se preenchido e alterado (evita rejeitar contas legadas sem e-mail).
        if (form.email && form.email !== (editing.email ?? "")) body.email = form.email;
        await api.patch(`/users/${editing.id}`, body);
      } else {
        await api.post("/users", { username: form.username, email: form.email, password: form.password, role: form.role });
      }
      setOpen(false);
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(u: AppUser) {
    const label = t(`common:roles.${roleOf(u)}`);
    const who = `${label} "${u.username}"${u.email ? ` (${u.email})` : ""}`;
    if (!(await confirm({ title: t("access:users.delete.title"), message: t("access:users.delete.message", { who }) }))) return;
    try {
      await api.del(`/users/${u.id}`);
      load();
    } catch (e) {
      await alert({ title: t("access:errorTitle"), message: t("access:users.deleteFailed", { error: e instanceof ApiError ? e.message : String(e) }), tone: "danger" });
    }
  }

  // Papéis que o ator pode atribuir (Master só por Master).
  const roleOptions: Role[] = isMaster ? ["operator", "admin", "master"] : ["operator", "admin"];

  return (
    <div>
      <PageHeader
        title={t("access:users.title")}
        subtitle={t("access:users.subtitle")}
        actions={<Button onClick={openNew}><Plus className="h-4 w-4" /> {t("access:users.add")}</Button>}
      />

      {loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
      ) : items.length === 0 ? (
        <EmptyState title={t("access:users.empty")} />
      ) : (
        <Table head={<><Th>{t("common:labels.username")}</Th><Th>{t("access:users.columns.email")}</Th><Th>{t("access:users.columns.role")}</Th><Th className="text-right">{t("common:labels.actions")}</Th></>}>
          {items.map((u) => {
            const r = roleOf(u);
            return (
              <tr key={u.id} className="hover:bg-surface-2 transition-colors duration-200">
                <Td className="font-medium">
                  {u.username} {u.id === me?.id && <Badge tone="muted">{t("access:users.you")}</Badge>}
                </Td>
                <Td className="text-muted">{u.email || <span className="text-danger/70">{t("access:users.noEmail")}</span>}</Td>
                <Td><Badge tone={r === "master" ? "accent" : r === "admin" ? "primary" : "muted"}>{t(`common:roles.${r}`)}</Badge></Td>
                <Td className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="ghost" onClick={() => openEdit(u)}>{t("common:actions.edit")}</Button>
                    <Button variant="danger" onClick={() => remove(u)} disabled={u.id === me?.id}>{t("common:actions.delete")}</Button>
                  </div>
                </Td>
              </tr>
            );
          })}
        </Table>
      )}

      {open && (
        <Modal
          title={editing ? t("access:users.editTitle", { name: editing.username }) : t("access:users.add")}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>{t("common:actions.cancel")}</Button>
              <Button onClick={save} disabled={saving || (!editing && (!form.username || !form.email || !form.password))}>
                {saving ? t("common:actions.saving") : editing ? t("common:actions.save") : t("common:actions.create")}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <Fld label={t("common:labels.username")}>
              <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} disabled={!!editing} autoFocus={!editing} />
            </Fld>
            <Fld label={t("access:users.emailLabel")}>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder={t("access:users.emailPlaceholder")} />
            </Fld>
            <Fld label={editing ? t("access:users.newPasswordLabel") : t("access:users.passwordLabel")}>
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={editing ? t("access:users.passwordKeepPlaceholder") : ""} />
              {form.password
                ? passwordError(form.password) && <p className="mt-1 text-[11px] text-danger">{t(PASSWORD_HINT_KEY)}</p>
                : !editing && <p className="mt-1 text-[11px] text-muted">{t(PASSWORD_HINT_KEY)}</p>}
            </Fld>
            <Fld label={t("access:users.roleLabel")}>
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {roleOptions.map((r) => <option key={r} value={r}>{t(`common:roles.${r}`)}</option>)}
                {/* mantém o papel atual visível mesmo que o ator não possa atribuí-lo */}
                {editing && !roleOptions.includes(form.role) && <option value={form.role}>{t(`common:roles.${form.role}`)}</option>}
              </Select>
            </Fld>
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
