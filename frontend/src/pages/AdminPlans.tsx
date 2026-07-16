import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Plan } from "@/lib/types";
import { Table, Td, Th } from "@/components/Table";
import { Button, EmptyState, Input, Modal, Spinner } from "@/components/ui";

const BLANK = { name: "", max_devices: 10, max_users: 5 };

export function AdminPlans() {
  const [items, setItems] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  function load() {
    setLoading(true);
    api.get<Plan[]>("/admin/plans").then(setItems).finally(() => setLoading(false));
  }
  useEffect(load, []);

  function openNew() {
    setEditing(null);
    setForm(BLANK);
    setErr("");
    setOpen(true);
  }
  function openEdit(p: Plan) {
    setEditing(p);
    setForm({ name: p.name, max_devices: p.max_devices, max_users: p.max_users });
    setErr("");
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    setErr("");
    try {
      if (editing) await api.patch(`/admin/plans/${editing.id}`, form);
      else await api.post("/admin/plans", form);
      setOpen(false);
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: Plan) {
    if (!confirm(`Excluir o plano "${p.name}"?`)) return;
    await api.del(`/admin/plans/${p.id}`);
    load();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted">Planos e limites (devices/usuários) por organização.</p>
        <Button onClick={openNew}><Plus className="h-4 w-4" /> Add Plan</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
      ) : items.length === 0 ? (
        <EmptyState title="Nenhum plano" hint="Crie um plano para atribuir às ORGs." />
      ) : (
        <Table head={<><Th>Name</Th><Th>Max devices</Th><Th>Max users</Th><Th className="text-right">Actions</Th></>}>
          {items.map((p) => (
            <tr key={p.id} className="hover:bg-surface-2 transition-colors duration-200">
              <Td className="font-medium">{p.name}</Td>
              <Td className="font-mono">{p.max_devices}</Td>
              <Td className="font-mono">{p.max_users}</Td>
              <Td className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <Button variant="ghost" onClick={() => openEdit(p)}>Edit</Button>
                  <Button variant="danger" onClick={() => remove(p)}>Delete</Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      {open && (
        <Modal
          title={editing ? "Edit Plan" : "Add Plan"}
          onClose={() => setOpen(false)}
          footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={saving || !form.name}>{saving ? "…" : editing ? "Save" : "Create"}</Button></>}
        >
          <div className="space-y-3">
            <Fld label="NAME"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Fld>
            <Fld label="MAX DEVICES"><Input type="number" value={form.max_devices} onChange={(e) => setForm({ ...form, max_devices: Number(e.target.value) })} className="font-mono" /></Fld>
            <Fld label="MAX USERS"><Input type="number" value={form.max_users} onChange={(e) => setForm({ ...form, max_users: Number(e.target.value) })} className="font-mono" /></Fld>
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
