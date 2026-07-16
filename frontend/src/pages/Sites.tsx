import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/lib/api";
import type { Device, Group } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Table, Td, Th } from "@/components/Table";
import { Button, EmptyState, Input, Modal, Spinner } from "@/components/ui";
import { useConfirm } from "@/lib/confirm";
import { DeviceMap } from "@/components/DeviceMap";

const BLANK = { name: "", location: "", description: "", latitude: "", longitude: "" };

export function Sites() {
  const { confirm } = useConfirm();
  const [groups, setGroups] = useState<Group[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Group | null>(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([api.get<Group[]>("/groups"), api.get<Device[]>("/devices")])
      .then(([g, d]) => {
        setGroups(g);
        setDevices(d);
      })
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const counts = useMemo(() => {
    const c: Record<number, number> = {};
    for (const d of devices) if (d.group_id != null) c[d.group_id] = (c[d.group_id] ?? 0) + 1;
    return c;
  }, [devices]);

  function openNew() {
    setEditing(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(g: Group) {
    setEditing(g);
    setForm({ name: g.name, location: g.location ?? "", description: g.description ?? "", latitude: g.latitude != null ? String(g.latitude) : "", longitude: g.longitude != null ? String(g.longitude) : "" });
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        location: form.location,
        description: form.description,
        latitude: form.latitude ? Number(form.latitude) : null,
        longitude: form.longitude ? Number(form.longitude) : null,
      };
      if (editing) await api.patch(`/groups/${editing.id}`, payload);
      else await api.post("/groups", payload);
      setOpen(false);
      load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(g: Group) {
    if (!(await confirm({ title: "Excluir site", message: `Excluir o site "${g.name}"?` }))) return;
    await api.del(`/groups/${g.id}`);
    load();
  }

  return (
    <div>
      <PageHeader
        title="Sites"
        actions={<Button onClick={openNew}><Plus className="h-4 w-4" /> Adicionar Site</Button>}
      />

      {loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
      ) : groups.length === 0 ? (
        <EmptyState title="Nenhum site" hint="Crie um site para agrupar seus dispositivos." />
      ) : (
        <Table head={<><Th>Nome</Th><Th>Local</Th><Th>Descrição</Th><Th>Dispositivos</Th><Th className="text-right">Ações</Th></>}>
          {groups.map((g) => (
            <tr key={g.id} className="hover:bg-surface-2 transition-colors duration-200">
              <Td className="font-medium">{g.name}</Td>
              <Td className="text-muted">{g.location || "—"}</Td>
              <Td className="text-muted">{g.description || "—"}</Td>
              <Td className="font-mono">{counts[g.id] ?? 0}</Td>
              <Td className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <Button variant="ghost" onClick={() => openEdit(g)}>Editar</Button>
                  <Button variant="danger" onClick={() => remove(g)}>Excluir</Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      {open && (
        <Modal
          title={editing ? "Editar Site" : "Adicionar Site"}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={save} disabled={saving || !form.name}>{saving ? "Salvando…" : editing ? "Salvar" : "Adicionar Site"}</Button>
            </>
          }
        >
          <div className="space-y-3">
            <Field label="NOME">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
            </Field>
            <Field label="LOCAL">
              <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="ex.: Vitória, POP Centro" />
            </Field>
            <Field label="DESCRIÇÃO">
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Descrição opcional" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="LATITUDE">
                <Input type="number" step="any" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} placeholder="-20.1234" className="font-mono" />
              </Field>
              <Field label="LONGITUDE">
                <Input type="number" step="any" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} placeholder="-40.1234" className="font-mono" />
              </Field>
            </div>
            <div className="overflow-hidden rounded-lg border border-border">
              <DeviceMap
                key={editing?.id ?? "new"}
                lat={form.latitude ? Number(form.latitude) : null}
                lon={form.longitude ? Number(form.longitude) : null}
                label={form.name || undefined}
                height={200}
                onPick={(la, lo) => setForm((f) => ({ ...f, latitude: la.toFixed(6), longitude: lo.toFixed(6) }))}
              />
              <p className="px-3 py-1.5 text-[11px] text-muted">Clique no mapa (ou arraste o pino) para definir a localização.</p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] uppercase tracking-wide text-muted">{label}</label>
      {children}
    </div>
  );
}
