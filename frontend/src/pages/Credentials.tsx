import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Credential } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Table, Td, Th } from "@/components/Table";
import { Badge, Button, Card, EmptyState, Input, Select, Spinner } from "@/components/ui";

const BLANK = { name: "", kind: "ssh", username: "", secret: "" };

export function Credentials() {
  const [items, setItems] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(BLANK);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    api.get<Credential[]>("/credentials").then(setItems).finally(() => setLoading(false));
  }
  useEffect(load, []);

  function startEdit(c: Credential) {
    setEditingId(c.id);
    setForm({ name: c.name, kind: c.kind, username: c.username, secret: "" });
  }
  function reset() {
    setEditingId(null);
    setForm(BLANK);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingId) {
        const patch: Record<string, unknown> = { name: form.name, username: form.username };
        if (form.secret) patch.secret = form.secret; // só re-cifra se preenchido
        await api.patch(`/credentials/${editingId}`, patch);
      } else {
        await api.post("/credentials", form);
      }
      reset();
      load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("Excluir esta credencial?")) return;
    await api.del(`/credentials/${id}`);
    if (editingId === id) reset();
    load();
  }

  return (
    <div>
      <PageHeader title="Credenciais" subtitle="Perfis reutilizáveis (segredos cifrados)" />
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div>
          {loading ? (
            <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
          ) : items.length === 0 ? (
            <EmptyState title="Nenhuma credencial" hint="Crie um perfil ao lado." />
          ) : (
            <Table head={<><Th>Nome</Th><Th>Tipo</Th><Th>Usuário</Th><Th>Segredo</Th><Th /></>}>
              {items.map((c) => (
                <tr key={c.id} className="hover:bg-surface-2 transition-colors duration-200">
                  <Td className="font-medium">{c.name}</Td>
                  <Td><Badge tone="accent">{c.kind}</Badge></Td>
                  <Td className="text-muted">{c.username || "—"}</Td>
                  <Td className="font-mono text-muted">{c.secret}</Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" onClick={() => startEdit(c)}>Editar</Button>
                      <Button variant="danger" onClick={() => remove(c.id)}>Excluir</Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </div>
        <Card>
          <h2 className="mb-3 text-sm font-semibold">{editingId ? "Editar perfil" : "Novo perfil"}</h2>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="cn" className="text-xs text-muted">Nome</label>
              <Input id="cn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="space-y-1">
              <label htmlFor="ck" className="text-xs text-muted">Tipo</label>
              <Select id="ck" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} disabled={editingId !== null}>
                <option value="ssh">SSH</option>
                <option value="telnet">Telnet</option>
                <option value="snmp">SNMP (community)</option>
                <option value="api">API</option>
                <option value="tl1">TL1</option>
              </Select>
              {editingId && <p className="text-xs text-muted">O tipo não pode ser alterado.</p>}
            </div>
            <div className="space-y-1">
              <label htmlFor="cu" className="text-xs text-muted">Usuário (vazio p/ SNMP v2c)</label>
              <Input id="cu" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label htmlFor="cs" className="text-xs text-muted">
                Segredo / community {editingId && <span className="text-muted">(deixe vazio p/ manter)</span>}
              </label>
              <Input id="cs" type="password" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} />
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
