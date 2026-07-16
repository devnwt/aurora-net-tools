import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Webhook } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Table, Td, Th } from "@/components/Table";
import { Badge, Button, EmptyState, Input, Modal, Spinner } from "@/components/ui";

const EVENTS = [
  { key: "device.online", label: "Device online" },
  { key: "device.offline", label: "Device offline / não-acessível" },
];

const BLANK = { name: "", url: "", events: "", secret: "", enabled: true };

export function Webhooks() {
  const [items, setItems] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Webhook | null>(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [tested, setTested] = useState<Record<number, string>>({});

  function load() {
    setLoading(true);
    api.get<Webhook[]>("/webhooks").then(setItems).finally(() => setLoading(false));
  }
  useEffect(load, []);

  function openNew() {
    setEditing(null);
    setForm(BLANK);
    setErr("");
    setOpen(true);
  }
  function openEdit(w: Webhook) {
    setEditing(w);
    setForm({ name: w.name, url: w.url, events: w.events, secret: "", enabled: w.enabled });
    setErr("");
    setOpen(true);
  }

  const selected = new Set(form.events.split(",").map((e) => e.trim()).filter(Boolean));
  function toggleEvent(k: string) {
    const s = new Set(selected);
    s.has(k) ? s.delete(k) : s.add(k);
    setForm({ ...form, events: [...s].join(",") });
  }

  async function save() {
    setSaving(true);
    setErr("");
    try {
      if (editing) {
        const body: Record<string, unknown> = { name: form.name, url: form.url, events: form.events, enabled: form.enabled };
        if (form.secret) body.secret = form.secret;
        await api.patch(`/webhooks/${editing.id}`, body);
      } else {
        await api.post("/webhooks", form);
      }
      setOpen(false);
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function test(w: Webhook) {
    setTested((t) => ({ ...t, [w.id]: "…" }));
    try {
      const r = await api.post<{ ok: boolean; status: number }>(`/webhooks/${w.id}/test`);
      setTested((t) => ({ ...t, [w.id]: r.ok ? `entregue (${r.status})` : `resposta ${r.status}` }));
    } catch (e) {
      setTested((t) => ({ ...t, [w.id]: e instanceof ApiError ? `erro ${e.status}` : "falhou" }));
    }
  }

  async function remove(w: Webhook) {
    if (!confirm(`Excluir o webhook "${w.name}"?`)) return;
    await api.del(`/webhooks/${w.id}`);
    load();
  }

  return (
    <div>
      <PageHeader
        title="Webhooks"
        subtitle="Notificações HTTP em eventos (ex.: device caiu / voltou)"
        actions={<Button onClick={openNew}><Plus className="h-4 w-4" /> Add Webhook</Button>}
      />

      {loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
      ) : items.length === 0 ? (
        <EmptyState title="Nenhum webhook" hint="Crie um para receber notificações de eventos." />
      ) : (
        <Table head={<><Th>Name</Th><Th>URL</Th><Th>Events</Th><Th>Status</Th><Th className="text-right">Actions</Th></>}>
          {items.map((w) => (
            <tr key={w.id} className="hover:bg-surface-2 transition-colors duration-200">
              <Td className="font-medium">{w.name} {w.has_secret && <Badge tone="muted">signed</Badge>}</Td>
              <Td className="max-w-xs truncate font-mono text-xs text-muted" title={w.url}>{w.url}</Td>
              <Td className="text-xs text-muted">{w.events || "todos"}</Td>
              <Td>{w.enabled ? <Badge tone="ok">on</Badge> : <Badge tone="muted">off</Badge>}</Td>
              <Td className="text-right">
                <div className="flex items-center justify-end gap-2">
                  {tested[w.id] && <span className="text-xs text-muted">{tested[w.id]}</span>}
                  <Button variant="ghost" onClick={() => test(w)}>Test</Button>
                  <Button variant="ghost" onClick={() => openEdit(w)}>Edit</Button>
                  <Button variant="danger" onClick={() => remove(w)}>Delete</Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      {open && (
        <Modal
          title={editing ? "Edit Webhook" : "Add Webhook"}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={save} disabled={saving || !form.name || !form.url}>{saving ? "Salvando…" : editing ? "Save" : "Create"}</Button>
            </>
          }
        >
          <div className="space-y-3">
            <Fld label="NAME"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Fld>
            <Fld label="URL"><Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://exemplo.com/hook" className="font-mono" /></Fld>
            <Fld label="EVENTS (vazio = todos)">
              <div className="flex flex-col gap-1">
                {EVENTS.map((ev) => (
                  <label key={ev.key} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={selected.has(ev.key)} onChange={() => toggleEvent(ev.key)} /> {ev.label}
                  </label>
                ))}
              </div>
            </Fld>
            <Fld label={editing ? "SECRET (opcional — em branco mantém)" : "SECRET (opcional, HMAC-SHA256)"}>
              <Input value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} placeholder="assina o corpo se preenchido" className="font-mono" />
            </Fld>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enabled
            </label>
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
