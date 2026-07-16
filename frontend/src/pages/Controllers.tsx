import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import type { Controller, Credential } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Table, Td, Th } from "@/components/Table";
import { Button, Card, EmptyState, Input, Select, Spinner } from "@/components/ui";
import { useConfirm } from "@/lib/confirm";

const BLANK = { name: "", host: "", port: 3337, credential_id: "" as string };

export function Controllers() {
  const { confirm } = useConfirm();
  const [items, setItems] = useState<Controller[]>([]);
  const [creds, setCreds] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<number | null>(null);
  const [result, setResult] = useState<Record<number, { ok: boolean; msg: string }>>({});
  const [form, setForm] = useState(BLANK);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    api.get<Controller[]>("/controllers").then(setItems).finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    api.get<Credential[]>("/credentials").then(setCreds);
  }, []);

  function startEdit(c: Controller) {
    setEditingId(c.id);
    setForm({ name: c.name, host: c.host, port: c.port, credential_id: c.credential_id ? String(c.credential_id) : "" });
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
        host: form.host,
        port: form.port,
        credential_id: form.credential_id ? Number(form.credential_id) : null,
      };
      if (editingId) await api.patch(`/controllers/${editingId}`, payload);
      else await api.post("/controllers", { kind: "fiberhome_unm2000", ...payload });
      reset();
      load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    if (!(await confirm({ title: "Excluir controladora", message: "Excluir esta controladora?" }))) return;
    await api.del(`/controllers/${id}`);
    if (editingId === id) reset();
    load();
  }

  async function test(id: number) {
    setTesting(id);
    try {
      await api.post(`/controllers/${id}/test`);
      setResult((r) => ({ ...r, [id]: { ok: true, msg: "conectou" } }));
    } catch (e) {
      setResult((r) => ({ ...r, [id]: { ok: false, msg: e instanceof ApiError ? e.message : String(e) } }));
    } finally {
      setTesting(null);
    }
  }

  return (
    <div>
      <PageHeader title="Controladoras" subtitle="EMS/controladoras (ex.: UNM2000 Fiberhome)" />
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div>
          {loading ? (
            <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
          ) : items.length === 0 ? (
            <EmptyState title="Nenhuma controladora" hint="Cadastre um EMS ao lado." />
          ) : (
            <Table head={<><Th>Nome</Th><Th>Host</Th><Th>Porta</Th><Th /></>}>
              {items.map((c) => (
                <tr key={c.id} className="hover:bg-surface-2 transition-colors duration-200">
                  <Td className="font-medium">{c.name}</Td>
                  <Td className="font-mono text-muted">{c.host}</Td>
                  <Td className="font-mono text-muted">{c.port}</Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {result[c.id] && (
                        <span className={result[c.id].ok ? "text-xs text-ok" : "text-xs text-danger"}>{result[c.id].msg}</span>
                      )}
                      <Button variant="ghost" onClick={() => test(c.id)} disabled={testing !== null}>
                        {testing === c.id ? <Spinner /> : "Testar TL1"}
                      </Button>
                      <Link to={`/controllers/${c.id}/olts`}>
                        <Button variant="accent">OLTs</Button>
                      </Link>
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
          <h2 className="mb-3 text-sm font-semibold">{editingId ? "Editar controladora" : "Nova controladora (UNM2000)"}</h2>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="cnm" className="text-xs text-muted">Nome</label>
              <Input id="cnm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="space-y-1">
              <label htmlFor="chost" className="text-xs text-muted">Host</label>
              <Input id="chost" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} className="font-mono" required />
            </div>
            <div className="space-y-1">
              <label htmlFor="cport" className="text-xs text-muted">Porta TL1</label>
              <Input id="cport" type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} className="font-mono" />
            </div>
            <div className="space-y-1">
              <label htmlFor="ccred" className="text-xs text-muted">Credencial TL1</label>
              <Select id="ccred" value={form.credential_id} onChange={(e) => setForm({ ...form, credential_id: e.target.value })}>
                <option value="">— nenhuma —</option>
                {creds.filter((c) => c.kind === "tl1").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
