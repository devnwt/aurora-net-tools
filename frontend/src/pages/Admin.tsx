import { useEffect, useState } from "react";
import { Bot, Building2, Database, Mail, Package, Save, Sparkles } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { GlobalLlm, GlobalS3, GlobalSmtp } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { CopilotToolsManager } from "@/components/CopilotTools";
import { Button, Card, Input, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";
import { AdminOrgs } from "./AdminOrgs";
import { AdminPlans } from "./AdminPlans";

const errMsg = (e: unknown) => (e instanceof ApiError ? `Erro ${e.status}: ${e.message}` : String(e));

type Tab = "orgs" | "plans" | "smtp" | "llm" | "s3" | "copilot";
const TABS: { key: Tab; label: string; icon: typeof Building2 }[] = [
  { key: "orgs", label: "Organizações", icon: Building2 },
  { key: "plans", label: "Planos", icon: Package },
  { key: "smtp", label: "SMTP Global", icon: Mail },
  { key: "llm", label: "LLM Global", icon: Sparkles },
  { key: "s3", label: "MinIO / S3", icon: Database },
  { key: "copilot", label: "Ferramentas do Copilot", icon: Bot },
];

export function Admin() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("orgs");

  if (user?.role !== "master") {
    return <Card><p className="text-sm text-muted">Área restrita ao Master do sistema.</p></Card>;
  }

  return (
    <div>
      <PageHeader title="Super Admin" subtitle="Administração multi-tenant do sistema" />
      <div className="mb-5 flex flex-wrap items-center gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 rounded-t-lg px-4 py-2 text-sm transition-colors duration-200",
              tab === t.key ? "border-b-2 border-primary font-medium text-primary" : "text-muted hover:text-text",
            )}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>
      {tab === "orgs" && <AdminOrgs />}
      {tab === "plans" && <AdminPlans />}
      {tab === "smtp" && <SmtpGlobalTab />}
      {tab === "llm" && <LlmGlobalTab />}
      {tab === "s3" && <S3GlobalTab />}
      {tab === "copilot" && (
        <Card>
          <div className="mb-4 flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Ferramentas do Copilot (globais)</h2>
          </div>
          <CopilotToolsManager />
        </Card>
      )}
    </div>
  );
}

// === MinIO/S3 Global (destino de backups) ===

function S3GlobalTab() {
  const [data, setData] = useState<GlobalS3 | null>(null);
  const [f, setF] = useState({ enabled: false, endpoint: "", region: "us-east-1", bucket: "", access_key: "", prefix: "", use_ssl: true, secret_key: "" });
  const [keySet, setKeySet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function load() { api.get<GlobalS3>("/admin/s3").then(setData); }
  useEffect(load, []);
  useEffect(() => {
    if (!data) return;
    setF({ enabled: data.enabled, endpoint: data.endpoint, region: data.region, bucket: data.bucket, access_key: data.access_key, prefix: data.prefix, use_ssl: data.use_ssl, secret_key: "" });
    setKeySet(data.secret_key_set);
  }, [data]);

  if (!data) return <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const body: Record<string, unknown> = { enabled: f.enabled, endpoint: f.endpoint, region: f.region, bucket: f.bucket, access_key: f.access_key, prefix: f.prefix, use_ssl: f.use_ssl };
      if (f.secret_key) body.secret_key = f.secret_key;
      await api.put("/admin/s3", body);
      const fresh = await api.get<GlobalS3>("/admin/s3");
      setData(fresh);
      setMsg({ ok: true, text: `Salvo e confirmado às ${new Date().toLocaleTimeString("pt-BR")}.` });
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }); } finally { setBusy(false); }
  }
  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post<{ ok: boolean; detail: string }>("/admin/s3/test", {});
      setMsg({ ok: r.ok, text: r.detail });
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }); } finally { setBusy(false); }
  }

  return (
    <Card>
      <div className="mb-4 flex items-center gap-2">
        <Database className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">MinIO / S3 Global</h2>
        <div className="ml-auto">
          <label className="inline-flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} className="h-4 w-4 accent-primary" /> Habilitado
          </label>
        </div>
      </div>
      <p className="mb-4 text-xs text-muted">Armazenamento S3-compatível (MinIO, AWS S3, Ceph…) — <strong>destino de backups de todas as ORGs</strong>.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Endpoint" hint="host:porta ou URL"><Input value={f.endpoint} onChange={(e) => setF({ ...f, endpoint: e.target.value })} placeholder="minio.local:9000" className="font-mono text-xs" /></Field>
        <Field label="Bucket"><Input value={f.bucket} onChange={(e) => setF({ ...f, bucket: e.target.value })} placeholder="backups" className="font-mono" /></Field>
        <Field label="Access Key"><Input value={f.access_key} onChange={(e) => setF({ ...f, access_key: e.target.value })} className="font-mono" /></Field>
        <Field label="Secret Key" hint={keySet ? "Já definida — preencha para trocar." : undefined}>
          <Input type="password" value={f.secret_key} onChange={(e) => setF({ ...f, secret_key: e.target.value })} placeholder={keySet ? "•••••••• (definida)" : ""} className="font-mono" />
        </Field>
        <Field label="Region"><Input value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} placeholder="us-east-1" className="font-mono" /></Field>
        <Field label="Prefixo (pasta)" hint="opcional"><Input value={f.prefix} onChange={(e) => setF({ ...f, prefix: e.target.value })} placeholder="routeros/" className="font-mono" /></Field>
        <div className="flex items-end">
          <label className="inline-flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={f.use_ssl} onChange={(e) => setF({ ...f, use_ssl: e.target.checked })} className="h-4 w-4 accent-primary" /> HTTPS (TLS)
          </label>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button onClick={save} disabled={busy}><Save className="h-4 w-4" /> Salvar</Button>
        <Button variant="ghost" className="ml-auto" onClick={test} disabled={busy}>Testar bucket</Button>
      </div>
      {msg && <p className={cn("mt-4 rounded-lg border p-3 text-sm", msg.ok ? "border-ok/40 bg-ok/10 text-ok" : "border-danger/40 bg-danger/10 text-danger")}>{msg.text}</p>}
    </Card>
  );
}

// === LLM Global (usado pelo Copilot de todas as ORGs) ===

function LlmGlobalTab() {
  const [data, setData] = useState<GlobalLlm | null>(null);
  const [f, setF] = useState({ enabled: false, base_url: "", model: "", api_key: "" });
  const [keySet, setKeySet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function load() { api.get<GlobalLlm>("/admin/llm").then(setData); }
  useEffect(load, []);
  useEffect(() => {
    if (!data) return;
    setF({ enabled: data.enabled, base_url: data.base_url, model: data.model, api_key: "" });
    setKeySet(data.api_key_set);
  }, [data]);

  if (!data) return <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const body: Record<string, unknown> = { enabled: f.enabled, base_url: f.base_url, model: f.model };
      if (f.api_key) body.api_key = f.api_key;
      await api.put("/admin/llm", body);
      const fresh = await api.get<GlobalLlm>("/admin/llm");
      setData(fresh);
      setMsg({ ok: true, text: `Salvo e confirmado às ${new Date().toLocaleTimeString("pt-BR")}.` });
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }); } finally { setBusy(false); }
  }
  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post<{ ok: boolean; detail: string }>("/admin/llm/test", {});
      setMsg({ ok: r.ok, text: r.detail });
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }); } finally { setBusy(false); }
  }

  return (
    <Card>
      <div className="mb-4 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">LLM Global (compatível com OpenAI)</h2>
        <div className="ml-auto">
          <label className="inline-flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} className="h-4 w-4 accent-primary" /> Habilitado
          </label>
        </div>
      </div>
      <p className="mb-4 text-xs text-muted">Provedor de LLM do sistema — usado pelo <strong>Copilot de todas as organizações</strong>. Qualquer endpoint compatível com a API da OpenAI (OpenAI, Groq, Ollama, vLLM, LM Studio…).</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Base URL" hint="inclua /v1 quando aplicável">
          <Input value={f.base_url} onChange={(e) => setF({ ...f, base_url: e.target.value })} placeholder="https://api.openai.com/v1" className="font-mono text-xs" />
        </Field>
        <Field label="Modelo"><Input value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} placeholder="gpt-4o-mini" className="font-mono" /></Field>
        <Field label="API Key" hint={keySet ? "Já definida — preencha para trocar." : undefined}>
          <Input type="password" value={f.api_key} onChange={(e) => setF({ ...f, api_key: e.target.value })} placeholder={keySet ? "•••••••• (definida)" : "sk-…"} className="font-mono" />
        </Field>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button onClick={save} disabled={busy}><Save className="h-4 w-4" /> Salvar</Button>
        <Button variant="ghost" className="ml-auto" onClick={test} disabled={busy}>Testar conexão</Button>
      </div>
      {msg && <p className={cn("mt-4 rounded-lg border p-3 text-sm", msg.ok ? "border-ok/40 bg-ok/10 text-ok" : "border-danger/40 bg-danger/10 text-danger")}>{msg.text}</p>}
    </Card>
  );
}

// === SMTP Global (config do sistema, base dos e-mails de acesso) ===

function SmtpGlobalTab() {
  const [data, setData] = useState<GlobalSmtp | null>(null);
  const [f, setF] = useState({ enabled: false, host: "", port: "587", username: "", from_addr: "", use_tls: true, password: "" });
  const [pwSet, setPwSet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [to, setTo] = useState("");

  function load() { api.get<GlobalSmtp>("/admin/smtp").then(setData); }
  useEffect(load, []);
  useEffect(() => {
    if (!data) return;
    setF({ enabled: data.enabled, host: data.host, port: String(data.port), username: data.username, from_addr: data.from_addr, use_tls: data.use_tls, password: "" });
    setPwSet(data.password_set);
  }, [data]);

  if (!data) return <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const body: Record<string, unknown> = { enabled: f.enabled, host: f.host, port: Number(f.port) || 587, username: f.username, from_addr: f.from_addr, use_tls: f.use_tls };
      if (f.password) body.password = f.password;
      await api.put("/admin/smtp", body);
      const fresh = await api.get<GlobalSmtp>("/admin/smtp");
      setData(fresh);
      setMsg({ ok: true, text: `Salvo e confirmado às ${new Date().toLocaleTimeString("pt-BR")}.` });
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }); } finally { setBusy(false); }
  }
  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post<{ ok: boolean; detail: string }>("/admin/smtp/test", { to });
      setMsg({ ok: r.ok, text: r.detail });
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }); } finally { setBusy(false); }
  }

  return (
    <Card>
      <div className="mb-4 flex items-center gap-2">
        <Mail className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">SMTP Global</h2>
        <div className="ml-auto">
          <label className="inline-flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} className="h-4 w-4 accent-primary" /> Habilitado
          </label>
        </div>
      </div>
      <p className="mb-4 text-xs text-muted">Servidor de e-mail do sistema — usado para <strong>boas-vindas de novos cadastros</strong> e <strong>reenvio de login</strong>.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Host"><Input value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} placeholder="smtp.gmail.com" /></Field>
        <Field label="Porta"><Input value={f.port} onChange={(e) => setF({ ...f, port: e.target.value })} className="font-mono" inputMode="numeric" /></Field>
        <Field label="Usuário"><Input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} placeholder="user@dominio.com" /></Field>
        <Field label="Senha" hint={pwSet ? "Já definida — preencha para trocar." : undefined}>
          <Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder={pwSet ? "•••••••• (definida)" : ""} />
        </Field>
        <Field label="Remetente (From)"><Input value={f.from_addr} onChange={(e) => setF({ ...f, from_addr: e.target.value })} placeholder="noreply@dominio.com" /></Field>
        <div className="flex items-end">
          <label className="inline-flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={f.use_tls} onChange={(e) => setF({ ...f, use_tls: e.target.checked })} className="h-4 w-4 accent-primary" /> STARTTLS
          </label>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button onClick={save} disabled={busy}><Save className="h-4 w-4" /> Salvar</Button>
        <div className="ml-auto flex items-center gap-2">
          <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="destino do teste" className="w-56" />
          <Button variant="ghost" onClick={test} disabled={busy || !to}>Enviar teste</Button>
        </div>
      </div>
      {msg && <p className={cn("mt-4 rounded-lg border p-3 text-sm", msg.ok ? "border-ok/40 bg-ok/10 text-ok" : "border-danger/40 bg-danger/10 text-danger")}>{msg.text}</p>}
    </Card>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] uppercase tracking-wide text-muted">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted">{hint}</p>}
    </div>
  );
}
