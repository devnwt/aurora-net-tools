import { useEffect, useState } from "react";
import { Mail, Plus, KeyRound, UserPlus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { OrgMeta, Plan } from "@/lib/types";
import { Table, Td, Th } from "@/components/Table";
import { Badge, Button, Card, EmptyState, Input, Modal, Select, Spinner } from "@/components/ui";

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : String(e));

export function AdminOrgs() {
  const [items, setItems] = useState<OrgMeta[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<OrgMeta | null>(null);
  const [form, setForm] = useState({ name: "", plan_id: "", device_limit: "", admin_username: "", admin_password: "", admin_email: "", send_welcome: true });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [reg, setReg] = useState<{ enabled: boolean; plan_id: number | null } | null>(null);

  function load() {
    setLoading(true);
    Promise.all([api.get<OrgMeta[]>("/admin/orgs"), api.get<Plan[]>("/admin/plans")])
      .then(([o, p]) => { setItems(o); setPlans(p); })
      .finally(() => setLoading(false));
  }
  useEffect(load, []);
  useEffect(() => { api.get<{ enabled: boolean; plan_id: number | null }>("/admin/registration").then(setReg).catch(() => {}); }, []);

  async function saveReg(next: { enabled: boolean; plan_id: number | null }) {
    setReg(next);
    try { setReg(await api.put<{ enabled: boolean; plan_id: number | null }>("/admin/registration", next)); }
    catch (e) { setNote({ ok: false, text: errMsg(e) }); }
  }

  function openNew() {
    setEditing(null);
    setForm({ name: "", plan_id: plans[0] ? String(plans[0].id) : "", device_limit: "", admin_username: "", admin_password: "", admin_email: "", send_welcome: true });
    setErr("");
    setOpen(true);
  }
  function openEdit(o: OrgMeta) {
    setEditing(o);
    setForm({ name: o.name, plan_id: o.plan_id ? String(o.plan_id) : "", device_limit: o.device_limit != null ? String(o.device_limit) : "", admin_username: "", admin_password: "", admin_email: o.admin_email ?? "", send_welcome: false });
    setErr("");
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    setErr("");
    try {
      const planId = form.plan_id ? Number(form.plan_id) : null;
      const devLimit = form.device_limit ? Number(form.device_limit) : null;
      if (editing) {
        await api.patch(`/admin/orgs/${editing.id}`, { name: form.name, plan_id: planId, device_limit: devLimit, admin_email: form.admin_email || null });
      } else {
        const r = await api.post<OrgMeta & { welcome?: { ok: boolean; detail: string } }>("/admin/orgs", {
          name: form.name, plan_id: planId, device_limit: devLimit,
          admin_username: form.admin_username, admin_password: form.admin_password,
          admin_email: form.admin_email || null, send_welcome: form.send_welcome,
        });
        if (r.welcome) setNote(r.welcome.ok ? { ok: true, text: `Boas-vindas: ${r.welcome.detail}` } : { ok: false, text: `Boas-vindas falhou: ${r.welcome.detail}` });
      }
      setOpen(false);
      load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(o: OrgMeta) {
    if (!confirm(`Excluir a ORG "${o.name}"? Isso remove seus devices, sites, credenciais e usuários.`)) return;
    await api.del(`/admin/orgs/${o.id}`);
    load();
  }

  async function resendLogin(o: OrgMeta) {
    if (!confirm(`Redefinir a senha do admin de "${o.name}" e enviar por e-mail (${o.admin_email ?? "sem e-mail"})?`)) return;
    setNote(null);
    try {
      const r = await api.post<{ ok: boolean; detail: string }>(`/admin/orgs/${o.id}/resend-login`, {});
      setNote({ ok: r.ok, text: r.ok ? `Login reenviado: ${r.detail}` : `Falhou: ${r.detail}` });
    } catch (e) {
      setNote({ ok: false, text: errMsg(e) });
    }
  }

  const valid = editing ? !!form.name : form.name && form.admin_username && form.admin_password;

  return (
    <div>
      {/* Cadastro público (self-signup) */}
      {reg && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <UserPlus className="h-4 w-4 text-primary" />
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={reg.enabled} onChange={(e) => saveReg({ ...reg, enabled: e.target.checked })} className="h-4 w-4 accent-primary" />
              <strong>Permitir cadastro público</strong>
            </label>
            <span className="text-xs text-muted">Quem se cadastra cria a própria organização + admin.</span>
            {reg.enabled && (
              <div className="ml-auto flex items-center gap-2 text-xs text-muted">
                Plano padrão:
                <Select value={reg.plan_id != null ? String(reg.plan_id) : ""} onChange={(e) => saveReg({ ...reg, plan_id: e.target.value ? Number(e.target.value) : null })} className="w-40">
                  <option value="">— sem plano —</option>
                  {plans.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.max_devices} dev)</option>)}
                </Select>
              </div>
            )}
          </div>
        </Card>
      )}

      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted">Organizações (tenants), planos, cotas e admins.</p>
        <Button onClick={openNew}><Plus className="h-4 w-4" /> Add Org</Button>
      </div>

      {note && <p className={`mb-3 rounded-lg border p-2 text-sm ${note.ok ? "border-ok/40 bg-ok/10 text-ok" : "border-danger/40 bg-danger/10 text-danger"}`}>{note.text}</p>}

      {loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
      ) : items.length === 0 ? (
        <EmptyState title="Nenhuma ORG" hint="Crie uma organização e seu administrador." />
      ) : (
        <Table head={<><Th>Name</Th><Th>Admin</Th><Th>Plan</Th><Th>Devices</Th><Th>Users</Th><Th className="text-right">Actions</Th></>}>
          {items.map((o) => (
            <tr key={o.id} className="hover:bg-surface-2 transition-colors duration-200">
              <Td className="font-medium">{o.name}</Td>
              <Td className="text-xs">
                <div>{o.admin_username ?? "—"}</div>
                <div className="text-muted">{o.admin_email ?? <span className="italic">sem e-mail</span>}</div>
              </Td>
              <Td>{o.plan ? <Badge tone="primary">{o.plan}</Badge> : <Badge tone="muted">sem plano</Badge>}</Td>
              <Td className="font-mono">{o.devices}{o.device_limit != null && <span className="text-muted"> / {o.device_limit}</span>}</Td>
              <Td className="font-mono">{o.users}</Td>
              <Td className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <Button variant="ghost" onClick={() => resendLogin(o)} title="Redefinir senha e enviar por e-mail"><KeyRound className="h-4 w-4" /> Reenviar login</Button>
                  <Button variant="ghost" onClick={() => openEdit(o)}>Edit</Button>
                  <Button variant="danger" onClick={() => remove(o)}>Delete</Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      {open && (
        <Modal
          title={editing ? `Edit ${editing.name}` : "Add Organization"}
          onClose={() => setOpen(false)}
          footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={saving || !valid}>{saving ? "…" : editing ? "Save" : "Create"}</Button></>}
        >
          <div className="space-y-3">
            <Fld label="NAME"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Fld>
            <Fld label="PLAN">
              <Select value={form.plan_id} onChange={(e) => setForm({ ...form, plan_id: e.target.value })}>
                <option value="">— sem plano —</option>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.max_devices} devices)</option>)}
              </Select>
            </Fld>
            <Fld label="DEVICE LIMIT (override, opcional)"><Input type="number" value={form.device_limit} onChange={(e) => setForm({ ...form, device_limit: e.target.value })} placeholder="usa o do plano se vazio" className="font-mono" /></Fld>
            <div className="border-t border-border pt-3 text-xs font-semibold text-muted">ADMINISTRADOR DA ORG</div>
            {!editing && (
              <>
                <Fld label="ADMIN USERNAME"><Input value={form.admin_username} onChange={(e) => setForm({ ...form, admin_username: e.target.value })} /></Fld>
                <Fld label="ADMIN PASSWORD"><Input type="password" value={form.admin_password} onChange={(e) => setForm({ ...form, admin_password: e.target.value })} /></Fld>
              </>
            )}
            <Fld label="ADMIN E-MAIL"><Input type="email" value={form.admin_email} onChange={(e) => setForm({ ...form, admin_email: e.target.value })} placeholder="admin@empresa.com" /></Fld>
            {!editing && (
              <label className="inline-flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={form.send_welcome} onChange={(e) => setForm({ ...form, send_welcome: e.target.checked })} className="h-4 w-4 accent-primary" />
                <Mail className="h-4 w-4" /> Enviar e-mail de boas-vindas com as credenciais
              </label>
            )}
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
