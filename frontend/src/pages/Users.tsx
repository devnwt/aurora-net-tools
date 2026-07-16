import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { AppUser } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Table, Td, Th } from "@/components/Table";
import { Badge, Button, EmptyState, Input, Modal, Select, Spinner } from "@/components/ui";

type Role = "operator" | "admin" | "master";
const ROLE_LABEL: Record<Role, string> = { operator: "Operador", admin: "Administrador", master: "Master" };
const roleOf = (u: AppUser): Role => (u.role as Role) ?? (u.is_admin ? "admin" : "operator");

export function Users() {
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
    if (!confirm(`Excluir o usuário "${u.username}"?`)) return;
    try {
      await api.del(`/users/${u.id}`);
      load();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : String(e));
    }
  }

  // Papéis que o ator pode atribuir (Master só por Master).
  const roleOptions: Role[] = isMaster ? ["operator", "admin", "master"] : ["operator", "admin"];

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Contas de acesso ao Aurora"
        actions={<Button onClick={openNew}><Plus className="h-4 w-4" /> Add User</Button>}
      />

      {loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
      ) : items.length === 0 ? (
        <EmptyState title="Nenhum usuário" />
      ) : (
        <Table head={<><Th>Username</Th><Th>E-mail</Th><Th>Papel</Th><Th className="text-right">Actions</Th></>}>
          {items.map((u) => {
            const r = roleOf(u);
            return (
              <tr key={u.id} className="hover:bg-surface-2 transition-colors duration-200">
                <Td className="font-medium">
                  {u.username} {u.id === me?.id && <Badge tone="muted">você</Badge>}
                </Td>
                <Td className="text-muted">{u.email || <span className="text-danger/70">— sem e-mail —</span>}</Td>
                <Td><Badge tone={r === "master" ? "accent" : r === "admin" ? "primary" : "muted"}>{ROLE_LABEL[r]}</Badge></Td>
                <Td className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="ghost" onClick={() => openEdit(u)}>Edit</Button>
                    <Button variant="danger" onClick={() => remove(u)} disabled={u.id === me?.id}>Delete</Button>
                  </div>
                </Td>
              </tr>
            );
          })}
        </Table>
      )}

      {open && (
        <Modal
          title={editing ? `Edit ${editing.username}` : "Add User"}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={save} disabled={saving || (!editing && (!form.username || !form.email || !form.password))}>
                {saving ? "Salvando…" : editing ? "Save" : "Create"}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <Fld label="USERNAME">
              <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} disabled={!!editing} autoFocus={!editing} />
            </Fld>
            <Fld label="E-MAIL (login)">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="voce@empresa.com" />
            </Fld>
            <Fld label={editing ? "NEW PASSWORD (opcional)" : "PASSWORD"}>
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={editing ? "deixe em branco para manter" : ""} />
            </Fld>
            <Fld label="PAPEL">
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                {/* mantém o papel atual visível mesmo que o ator não possa atribuí-lo */}
                {editing && !roleOptions.includes(form.role) && <option value={form.role}>{ROLE_LABEL[form.role]}</option>}
              </Select>
            </Fld>
            <p className="text-[11px] text-muted">
              <strong>Operador</strong>: usa o sistema. <strong>Administrador</strong>: gere a própria organização.
              {isMaster && <> <strong>Master</strong>: superadmin do sistema.</>}
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
