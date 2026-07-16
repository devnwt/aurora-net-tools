import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Credential, Group } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Table, Td, Th } from "@/components/Table";
import { Button, Card, EmptyState, Input, Select, Spinner } from "@/components/ui";

const BLANK = {
  name: "",
  description: "",
  default_ssh_credential_id: "" as string,
  default_snmp_credential_id: "" as string,
};

export function Groups() {
  const [items, setItems] = useState<Group[]>([]);
  const [creds, setCreds] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(BLANK);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    api.get<Group[]>("/groups").then(setItems).finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    api.get<Credential[]>("/credentials").then(setCreds);
  }, []);

  function startEdit(g: Group) {
    setEditingId(g.id);
    setForm({
      name: g.name,
      description: g.description ?? "",
      default_ssh_credential_id: g.default_ssh_credential_id ? String(g.default_ssh_credential_id) : "",
      default_snmp_credential_id: g.default_snmp_credential_id ? String(g.default_snmp_credential_id) : "",
    });
  }
  function reset() {
    setEditingId(null);
    setForm(BLANK);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        description: form.description,
        default_ssh_credential_id: form.default_ssh_credential_id ? Number(form.default_ssh_credential_id) : null,
        default_snmp_credential_id: form.default_snmp_credential_id ? Number(form.default_snmp_credential_id) : null,
      };
      if (editingId) await api.patch(`/groups/${editingId}`, payload);
      else await api.post("/groups", payload);
      reset();
      load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("Excluir este grupo? Devices ficam sem grupo.")) return;
    await api.del(`/groups/${id}`);
    if (editingId === id) reset();
    load();
  }

  const sshCreds = creds.filter((c) => c.kind === "ssh");
  const snmpCreds = creds.filter((c) => c.kind === "snmp");

  return (
    <div>
      <PageHeader title="Grupos" subtitle="Agrupam equipamentos e definem credenciais-padrão" />
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div>
          {loading ? (
            <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
          ) : items.length === 0 ? (
            <EmptyState title="Nenhum grupo" hint="Crie um grupo ao lado." />
          ) : (
            <Table head={<><Th>Nome</Th><Th>Descrição</Th><Th /></>}>
              {items.map((g) => (
                <tr key={g.id} className="hover:bg-surface-2 transition-colors duration-200">
                  <Td className="font-medium">{g.name}</Td>
                  <Td className="text-muted">{g.description || "—"}</Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" onClick={() => startEdit(g)}>Editar</Button>
                      <Button variant="danger" onClick={() => remove(g.id)}>Excluir</Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </div>
        <Card>
          <h2 className="mb-3 text-sm font-semibold">{editingId ? "Editar grupo" : "Novo grupo"}</h2>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="gn" className="text-xs text-muted">Nome</label>
              <Input id="gn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="space-y-1">
              <label htmlFor="gd" className="text-xs text-muted">Descrição</label>
              <Input id="gd" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label htmlFor="gssh" className="text-xs text-muted">Credencial SSH padrão</label>
              <Select id="gssh" value={form.default_ssh_credential_id} onChange={(e) => setForm({ ...form, default_ssh_credential_id: e.target.value })}>
                <option value="">— nenhuma —</option>
                {sshCreds.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
            <div className="space-y-1">
              <label htmlFor="gsnmp" className="text-xs text-muted">Credencial SNMP padrão</label>
              <Select id="gsnmp" value={form.default_snmp_credential_id} onChange={(e) => setForm({ ...form, default_snmp_credential_id: e.target.value })}>
                <option value="">— nenhuma —</option>
                {snmpCreds.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
            <div className="flex gap-2">
              <Button type="submit" className="flex-1" disabled={saving}>{saving ? "Salvando…" : editingId ? "Salvar" : "Criar"}</Button>
              {editingId && <Button type="button" variant="ghost" onClick={reset}>Cancelar</Button>}
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
