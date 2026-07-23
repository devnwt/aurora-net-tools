import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Languages, RefreshCw, Save, Server } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import type { Integrations } from "@/lib/types";
import { useLocale } from "@/i18n/useLocale";
import { isSupportedLocale, type SupportedLocale } from "@/i18n/config";
import { PageHeader } from "@/components/PageHeader";
import { Badge, Button, Card, Input, Select, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";
import i18n from "@/i18n";

interface Info {
  app: string;
  poll_enabled: boolean;
  poll_interval_seconds: number;
  poll_concurrency: number;
  sample_retention_days: number;
  counts: { devices: number; statuses: number; samples: number };
}

type Tab = "preferences" | "home" | "ftp";
const TABS: Tab[] = ["preferences", "home", "ftp"];

export function Settings() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("preferences");
  return (
    <div>
      <PageHeader title={t("settings:title")} subtitle={t("settings:subtitle")} />
      <div className="mb-5 flex flex-wrap items-center gap-1 border-b border-border">
        {TABS.map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "cursor-pointer rounded-t-lg px-4 py-2 text-sm transition-colors duration-200",
              tab === key ? "border-b-2 border-primary font-medium text-primary" : "text-muted hover:text-text",
            )}
          >
            {t(`settings:tabs.${key}`)}
          </button>
        ))}
      </div>
      {tab === "preferences" && <PreferencesTab />}
      {tab === "home" && <HomeTab />}
      {tab === "ftp" && <FtpTab />}
    </div>
  );
}

// === Preferências da interface (idioma) ===

/** Linha de configuração: rótulo + descrição à esquerda, controle à direita. */
function SettingRow({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 border-t border-border py-4 first:border-t-0 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-8">
      <div>
        <label htmlFor={htmlFor} className="text-sm font-medium">{label}</label>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-muted">{hint}</p>}
      </div>
      <div className="sm:justify-self-end">{children}</div>
    </div>
  );
}

function PreferencesTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const { locale, setLocale, locales } = useLocale();
  // Seleção "pendente": só aplica quando confirma no OK (não troca ao digitar).
  const [pending, setPending] = useState<SupportedLocale>(locale);
  const dirty = pending !== locale;

  function apply() {
    setLocale(pending);
    // i18n já trocou de forma síncrona — a mensagem sai no idioma novo.
    toast.success(i18n.t("settings:preferences.changed"));
  }

  return (
    <Card className="max-w-2xl">
      <div className="mb-1 flex items-center gap-2">
        <Languages className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">{t("settings:preferences.title")}</h2>
      </div>
      <p className="mb-4 text-xs text-muted">{t("settings:preferences.subtitle")}</p>

      <SettingRow label={t("settings:preferences.language")} hint={t("settings:preferences.languageDesc")} htmlFor="language">
        <div className="flex items-center gap-2">
          <Select
            id="language"
            className="w-44"
            value={pending}
            aria-label={t("settings:preferences.languageLabel")}
            onChange={(e) => isSupportedLocale(e.target.value) && setPending(e.target.value)}
          >
            {locales.map((l) => (
              <option key={l.code} value={l.code}>{l.flag} {l.label}</option>
            ))}
          </Select>
          <Button onClick={apply} disabled={!dirty} aria-label={t("common:actions.ok")}>
            <Check className="h-4 w-4" /> {t("common:actions.ok")}
          </Button>
        </div>
      </SettingRow>
    </Card>
  );
}

// === Home (sistema & poller) ===

function HomeTab() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<Info | null>(null);
  const [polling, setPolling] = useState(false);
  const [note, setNote] = useState("");

  function load() {
    api.get<Info>("/settings/info").then(setInfo);
  }
  useEffect(load, []);

  async function pollNow() {
    setPolling(true);
    setNote("");
    try {
      await api.post("/settings/poll");
      setNote(t("settings:system.pollTriggered"));
      setTimeout(load, 6000);
    } finally {
      setPolling(false);
    }
  }

  if (!info) return <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>;

  const rows: [string, React.ReactNode][] = [
    [t("settings:system.app"), info.app],
    [t("settings:system.poller"), info.poll_enabled ? <Badge tone="ok">{t("settings:system.enabled")}</Badge> : <Badge tone="muted">{t("settings:system.disabled")}</Badge>],
    [t("settings:system.interval"), `${info.poll_interval_seconds}s`],
    [t("settings:system.concurrency"), String(info.poll_concurrency)],
    [t("settings:system.retention"), t("settings:system.retentionValue", { days: info.sample_retention_days })],
  ];

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button onClick={pollNow} disabled={polling}>
          {polling ? <Spinner /> : <RefreshCw className="h-4 w-4" />} {t("settings:system.pollNow")}
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-semibold">{t("settings:system.title")}</h2>
          <dl className="space-y-2 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-2">
                <dt className="text-muted">{k}</dt>
                <dd className="font-mono">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted">{t("settings:system.envNote")}</p>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold">{t("settings:system.collected")}</h2>
          <div className="grid grid-cols-3 gap-3 text-center">
            <Stat label={t("settings:system.devices")} value={info.counts.devices} />
            <Stat label={t("settings:system.statuses")} value={info.counts.statuses} />
            <Stat label={t("settings:system.samples")} value={info.counts.samples} />
          </div>
        </Card>
      </div>
      {note && <p className="mt-4 rounded-lg border border-ok/40 bg-ok/10 p-3 text-sm text-ok">{note}</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

// === Integrações — helpers de UI ===

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={cn("inline-flex items-center gap-2 text-sm", disabled && "opacity-60")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn("relative h-5 w-9 rounded-full transition-colors", checked ? "bg-primary" : "bg-surface-2", !disabled && "cursor-pointer")}
      >
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </button>
      {label}
    </label>
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

/** Carrega /settings/integrations e expõe save + test. */
function useIntegrations() {
  const { t } = useTranslation();
  const errMsg = (e: unknown) =>
    e instanceof ApiError ? t("settings:errPrefix", { status: e.status, message: e.message }) : String(e);
  const [data, setData] = useState<Integrations | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function load() {
    api.get<Integrations>("/settings/integrations").then(setData);
  }
  useEffect(load, []);

  async function save(patch: Partial<Record<"ftp", unknown>>) {
    setBusy(true);
    setMsg(null);
    try {
      await api.put<Integrations>("/settings/integrations", patch);
      // Relê do servidor para confirmar que gravou de fato (fonte da verdade).
      const fresh = await api.get<Integrations>("/settings/integrations");
      setData(fresh);
      setMsg({ ok: true, text: t("settings:saved", { time: new Date().toLocaleTimeString(i18n.language) }) });
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  async function test(kind: "ftp", body?: unknown) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post<{ ok: boolean; detail: string }>(`/settings/integrations/${kind}/test`, body ?? {});
      setMsg({ ok: r.ok, text: r.detail });
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  return { data, busy, msg, save, test };
}

function ResultNote({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <p className={cn("mt-4 rounded-lg border p-3 text-sm", msg.ok ? "border-ok/40 bg-ok/10 text-ok" : "border-danger/40 bg-danger/10 text-danger")}>
      {msg.text}
    </p>
  );
}

// === FTP ===

function FtpTab() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "master";
  const { data, busy, msg, save, test } = useIntegrations();
  const [f, setF] = useState({ enabled: false, host: "", port: "21", username: "", path: "", use_tls: false, password: "" });
  const [pwSet, setPwSet] = useState(false);

  useEffect(() => {
    if (!data) return;
    const s = data.ftp;
    setF({ enabled: s.enabled, host: s.host, port: String(s.port), username: s.username, path: s.path, use_tls: s.use_tls, password: "" });
    setPwSet(s.password_set);
  }, [data]);

  if (!data) return <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>;

  const onSave = () => {
    const ftp: Record<string, unknown> = { enabled: f.enabled, host: f.host, port: Number(f.port) || 21, username: f.username, path: f.path, use_tls: f.use_tls };
    if (f.password) ftp.password = f.password;
    save({ ftp });
  };

  return (
    <Card>
      <div className="mb-4 flex items-center gap-2">
        <Server className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">{t("settings:ftp.title")}</h2>
        <div className="ml-auto"><Toggle checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label={t("settings:ftp.enabled")} disabled={!isAdmin} /></div>
      </div>
      <p className="mb-4 text-xs text-muted">{t("settings:ftp.desc")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("common:labels.host")}><Input value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} placeholder={t("settings:ftp.hostPlaceholder")} disabled={!isAdmin} /></Field>
        <Field label={t("common:labels.port")}><Input value={f.port} onChange={(e) => setF({ ...f, port: e.target.value })} className="font-mono" inputMode="numeric" disabled={!isAdmin} /></Field>
        <Field label={t("common:labels.username")}><Input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} disabled={!isAdmin} /></Field>
        <Field label={t("common:labels.password")} hint={pwSet ? t("settings:ftp.pwSet") : undefined}>
          <Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder={pwSet ? t("settings:ftp.pwPlaceholder") : ""} disabled={!isAdmin} />
        </Field>
        <Field label={t("settings:ftp.directory")}><Input value={f.path} onChange={(e) => setF({ ...f, path: e.target.value })} placeholder={t("settings:ftp.dirPlaceholder")} className="font-mono" disabled={!isAdmin} /></Field>
        <div className="flex items-end"><Toggle checked={f.use_tls} onChange={(v) => setF({ ...f, use_tls: v })} label={t("settings:ftp.ftps")} disabled={!isAdmin} /></div>
      </div>

      {isAdmin && (
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Button onClick={onSave} disabled={busy}><Save className="h-4 w-4" /> {t("common:actions.save")}</Button>
          <Button variant="ghost" className="ml-auto" onClick={() => test("ftp")} disabled={busy}>{t("settings:ftp.test")}</Button>
        </div>
      )}
      <ResultNote msg={msg} />
    </Card>
  );
}
