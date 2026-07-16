import { useEffect, useState } from "react";
import { Copy, Plus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { ApiKeyCreated, ApiKeyMeta } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Table, Td, Th } from "@/components/Table";
import { Button, EmptyState, Input, Modal, Spinner } from "@/components/ui";

export function ApiKeys() {
  const [items, setItems] = useState<ApiKeyMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const [copied, setCopied] = useState(false);

  function load() {
    setLoading(true);
    api.get<ApiKeyMeta[]>("/apikeys").then(setItems).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function create() {
    setSaving(true);
    setErr("");
    try {
      const k = await api.post<ApiKeyCreated>("/apikeys", { name });
      setOpen(false);
      setName("");
      setCreated(k);
      setCopied(false);
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(k: ApiKeyMeta) {
    if (!confirm(`Revogar a chave "${k.name}"? Integrações que a usam deixarão de funcionar.`)) return;
    await api.del(`/apikeys/${k.id}`);
    load();
  }

  async function copy(token: string) {
    await navigator.clipboard.writeText(token);
    setCopied(true);
  }

  return (
    <div>
      <PageHeader
        title="API Keys"
        subtitle="Tokens para acesso programático à API (header X-API-Key)"
        actions={<Button onClick={() => { setName(""); setErr(""); setOpen(true); }}><Plus className="h-4 w-4" /> Create Key</Button>}
      />

      {loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
      ) : items.length === 0 ? (
        <EmptyState title="Nenhuma chave" hint="Crie uma chave para integrar automações." />
      ) : (
        <Table head={<><Th>Name</Th><Th>Prefix</Th><Th>Created</Th><Th>Last used</Th><Th className="text-right">Actions</Th></>}>
          {items.map((k) => (
            <tr key={k.id} className="hover:bg-surface-2 transition-colors duration-200">
              <Td className="font-medium">{k.name}</Td>
              <Td className="font-mono text-muted">{k.prefix}…</Td>
              <Td className="whitespace-nowrap text-xs text-muted">{new Date(k.created_at).toLocaleString("pt-BR")}</Td>
              <Td className="whitespace-nowrap text-xs text-muted">{k.last_used_at ? new Date(k.last_used_at).toLocaleString("pt-BR") : "nunca"}</Td>
              <Td className="text-right"><Button variant="danger" onClick={() => remove(k)}>Revoke</Button></Td>
            </tr>
          ))}
        </Table>
      )}

      {open && (
        <Modal
          title="Create API Key"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={create} disabled={saving || !name}>{saving ? "Criando…" : "Create"}</Button>
            </>
          }
        >
          <div className="space-y-1">
            <label className="text-[11px] uppercase tracking-wide text-muted">NAME</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. automation, mcp, ci" autoFocus />
            {err && <p className="mt-2 rounded-lg border border-danger/40 bg-danger/10 p-2 text-sm text-danger">{err}</p>}
          </div>
        </Modal>
      )}

      {created && (
        <Modal title="Chave criada" onClose={() => setCreated(null)}>
          <p className="mb-3 text-sm text-muted">
            Copie a chave agora — ela <strong className="text-text">não será exibida novamente</strong>. Guarde-a com segurança.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs">{created.token}</code>
            <Button onClick={() => copy(created.token)}><Copy className="h-4 w-4" /> {copied ? "Copiado" : "Copiar"}</Button>
          </div>
          <p className="mt-3 text-xs text-muted">Use no header: <span className="font-mono">X-API-Key: {created.prefix}…</span></p>
        </Modal>
      )}
    </div>
  );
}
