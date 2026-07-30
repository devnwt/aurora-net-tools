import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Plan } from "@/lib/types";
import { formatBRL } from "@/lib/plans";
import { Table, Td, Th } from "@/components/Table";
import { Button, EmptyState, Input, Modal, Spinner } from "@/components/ui";
import { useConfirm } from "@/lib/confirm";

const BLANK = { name: "", max_devices: 10, max_users: 5, code: "", price: "", promo: "", description: "", sort_order: 0 };

// Reais digitados ("199", "549,99") → centavos (int) ou null quando vazio.
function toCents(v: string): number | null {
  const s = v.replace(",", ".").trim();
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
const centsToReais = (c?: number | null) => (c != null ? String(c / 100) : "");

export function AdminPlans() {
  const { confirm } = useConfirm();
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
    setForm({
      name: p.name, max_devices: p.max_devices, max_users: p.max_users, code: p.code ?? "",
      price: centsToReais(p.price_cents), promo: centsToReais(p.promo_price_cents),
      description: p.description ?? "", sort_order: p.sort_order ?? 0,
    });
    setErr("");
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    setErr("");
    const payload = {
      name: form.name, max_devices: form.max_devices, max_users: form.max_users, code: form.code || null,
      price_cents: toCents(form.price), promo_price_cents: toCents(form.promo),
      description: form.description.trim() || null, sort_order: Number(form.sort_order) || 0,
    };
    try {
      if (editing) await api.patch(`/admin/plans/${editing.id}`, payload);
      else await api.post("/admin/plans", payload);
      setOpen(false);
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: Plan) {
    if (!(await confirm({ title: "Excluir plano", message: `Excluir o plano "${p.name}"?` }))) return;
    await api.del(`/admin/plans/${p.id}`);
    load();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted">Planos e limites (devices/usuários) por organização.</p>
        <Button onClick={openNew}><Plus className="h-4 w-4" /> Adicionar Plano</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
      ) : items.length === 0 ? (
        <EmptyState title="Nenhum plano" hint="Crie um plano para atribuir às ORGs." />
      ) : (
        <Table head={<><Th>Ordem</Th><Th>Nome</Th><Th>Máx. dispositivos</Th><Th>Máx. usuários</Th><Th>Preço</Th><Th>Cobrança</Th><Th className="text-right">Ações</Th></>}>
          {items.map((p) => (
            <tr key={p.id} className="hover:bg-surface-2 transition-colors duration-200">
              <Td className="font-mono text-muted">{p.sort_order ?? 0}</Td>
              <Td className="font-medium">{p.name}{p.description && <div className="text-xs font-normal text-muted">{p.description}</div>}</Td>
              <Td className="font-mono">{p.max_devices}</Td>
              <Td className="font-mono">{p.max_users}</Td>
              <Td className="font-mono text-xs">
                {p.promo_price_cents != null ? (
                  <span>
                    {p.price_cents != null && <span className="mr-1 text-muted line-through">{formatBRL(p.price_cents / 100)}</span>}
                    {formatBRL(p.promo_price_cents / 100)}
                  </span>
                ) : p.price_cents != null ? formatBRL(p.price_cents / 100) : <span className="text-muted">—</span>}
              </Td>
              <Td className="font-mono text-xs">{p.code ? p.code : <span className="text-muted">—</span>}</Td>
              <Td className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <Button variant="ghost" onClick={() => openEdit(p)}>Editar</Button>
                  <Button variant="danger" onClick={() => remove(p)}>Excluir</Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      {open && (
        <Modal
          title={editing ? "Editar Plano" : "Adicionar Plano"}
          onClose={() => setOpen(false)}
          footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={save} disabled={saving || !form.name}>{saving ? "…" : editing ? "Salvar" : "Criar"}</Button></>}
        >
          <div className="space-y-3">
            <Fld label="NOME"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Fld>
            <Fld label="MÁX. DISPOSITIVOS"><Input type="number" value={form.max_devices} onChange={(e) => setForm({ ...form, max_devices: Number(e.target.value) })} className="font-mono" /></Fld>
            <Fld label="MÁX. USUÁRIOS"><Input type="number" value={form.max_users} onChange={(e) => setForm({ ...form, max_users: Number(e.target.value) })} className="font-mono" /></Fld>
            <Fld label="CÓDIGO DE COBRANÇA (plan_code)">
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="ex.: nettools-50-disp" className="font-mono" />
            </Fld>
            <div className="grid grid-cols-2 gap-3">
              <Fld label="PREÇO R$ (de)">
                <Input type="number" step="0.01" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="199" className="font-mono" />
              </Fld>
              <Fld label="PREÇO PROMOCIONAL R$ (por, opcional)">
                <Input type="number" step="0.01" min="0" value={form.promo} onChange={(e) => setForm({ ...form, promo: e.target.value })} placeholder="150" className="font-mono" />
              </Fld>
            </div>
            <Fld label="DESCRIÇÃO (texto do card)">
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="ex.: Ideal para pequenas equipes" />
            </Fld>
            <Fld label="ORDEM DE EXIBIÇÃO (menor primeiro)">
              <Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} className="font-mono" />
            </Fld>
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
