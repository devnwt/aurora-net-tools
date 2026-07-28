import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, CalendarClock, Camera, Check, CreditCard, KeyRound, Languages, RefreshCw, RotateCcw, Save, Server, Trash2, XCircle } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { useConfirm } from "@/lib/confirm";
import type { CurrentPlan, Integrations, OrgSummary } from "@/lib/types";
import { useLocale } from "@/i18n/useLocale";
import { isSupportedLocale, type SupportedLocale } from "@/i18n/config";
import { PageHeader } from "@/components/PageHeader";
import { Badge, Button, Card, Input, Modal, Select, Spinner, Toggle } from "@/components/ui";
import { MaskedInput } from "@/components/MaskedInput";
import { maskCpfCnpj } from "@/lib/masks";
import { normalizeDoc, isValidCpfCnpj } from "@/lib/documents";
import { PASSWORD_HINT_KEY, passwordError } from "@/lib/password";
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

type Tab = "profile" | "preferences" | "home" | "ftp" | "plans" | "danger";
const TABS: Tab[] = ["profile", "preferences", "home", "ftp", "plans", "danger"];

export function Settings() {
  const { t } = useTranslation();
  const { user } = useAuth();
  // A aba Planos é para admins de organização (admin ou master). A Danger Zone
  // (exclusão da empresa) é EXCLUSIVA do admin da empresa — o master não tem ORG.
  const isAdmin = user?.role === "admin" || user?.role === "master";
  const isCompanyAdmin = user?.role === "admin";
  const tabs = TABS.filter((k) => (k !== "plans" || isAdmin) && (k !== "danger" || isCompanyAdmin));
  // Aba controlada pela URL (/settings?tab=plans) — deep-link e persiste no refresh.
  // Sem param, ou aba inválida/sem permissão (operator em ?tab=plans), cai em "profile" (Meu Perfil).
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("tab") as Tab | null;
  const tab: Tab = rawTab && tabs.includes(rawTab) ? rawTab : "profile";
  const setTab = (next: Tab) => setSearchParams(next === "profile" ? {} : { tab: next }, { replace: true });
  return (
    <div>
      <PageHeader title={t("settings:title")} subtitle={t("settings:subtitle")} />
      <div className="mb-5 flex flex-wrap items-center gap-1 border-b border-border">
        {tabs.map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "cursor-pointer rounded-t-lg px-4 py-2 text-sm transition-colors duration-200",
              key === "danger"
                ? tab === key
                  ? "border-b-2 border-danger font-medium text-danger"
                  : "text-danger/70 hover:text-danger"
                : tab === key
                  ? "border-b-2 border-primary font-medium text-primary"
                  : "text-muted hover:text-text",
            )}
          >
            {t(`settings:tabs.${key}`)}
          </button>
        ))}
      </div>
      {tab === "profile" && <ProfileTab />}
      {tab === "preferences" && <PreferencesTab />}
      {tab === "home" && <HomeTab />}
      {tab === "ftp" && <FtpTab />}
      {tab === "plans" && <PlanTab />}
      {tab === "danger" && <DangerZoneTab />}
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
        <Field label={t("common:labels.port")}><MaskedInput mask="port" value={f.port} onValueChange={(v) => setF({ ...f, port: v })} className="font-mono" disabled={!isAdmin} /></Field>
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

// === Planos (aba do admin da ORG: status, vencimento e cancelamento) ===

const STATUS_TONE = { active: "ok", canceled: "accent", expired: "danger", none: "muted" } as const;

function PlanTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const { confirm } = useConfirm();
  const [cur, setCur] = useState<CurrentPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    api.get<CurrentPlan>("/plans/current").then(setCur).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function cancel() {
    const name = cur?.plan_name ?? "";
    if (!(await confirm({ title: t("settings:plan.cancelTitle"), message: t("settings:plan.cancelMsg", { name }), tone: "danger" }))) return;
    setBusy(true);
    try {
      setCur(await api.post<CurrentPlan>("/plans/cancel"));
      toast.success(t("settings:plan.canceled"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e : t("settings:plan.actionFailed"), { title: t("settings:plan.actionFailed") });
    } finally {
      setBusy(false);
    }
  }

  async function reactivate() {
    setBusy(true);
    try {
      setCur(await api.post<CurrentPlan>("/plans/reactivate"));
      toast.success(t("settings:plan.reactivated"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e : t("settings:plan.actionFailed"), { title: t("settings:plan.actionFailed") });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>;
  if (!cur) return null;
  if (!cur.has_org) return <Card><p className="text-sm text-muted">{t("settings:plan.noOrgAdmin")}</p></Card>;

  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : null);
  const expDate = fmtDate(cur.expires_at);
  const tone = STATUS_TONE[cur.status];

  return (
    <Card>
      <div className="mb-4 flex items-center gap-2">
        <CreditCard className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">{t("settings:plan.title")}</h2>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-border pb-4">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted">{t("settings:plan.current")}</p>
          <p className="text-lg font-semibold">{cur.plan_name ?? t("settings:plan.noPlan")}</p>
        </div>
        <Badge tone={tone}>{t(`settings:plan.status.${cur.status}`)}</Badge>
        {expDate && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted">
            <CalendarClock className="h-3.5 w-3.5" />
            {cur.expired ? t("settings:plan.expiredOn") : t("settings:plan.expiresAt")} <strong className="text-text">{expDate}</strong>
          </span>
        )}
      </div>

      {/* Uso atual */}
      <div className="grid gap-4 py-4 sm:grid-cols-2">
        <UsageLine label={t("settings:plan.devices")} used={cur.usage.devices} max={cur.max_devices} />
        <UsageLine label={t("settings:plan.users")} used={cur.usage.users} max={cur.max_users} />
      </div>

      {/* Avisos por estado */}
      {cur.status === "expired" && (
        <p className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{t("settings:plan.expiredNote")}</p>
      )}
      {cur.status === "canceled" && (
        <p className="rounded-lg border border-accent/40 bg-accent/10 p-3 text-sm text-accent">
          {expDate ? t("settings:plan.canceledNote", { date: expDate }) : t("settings:plan.canceledNoDate")}
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        {cur.canceled ? (
          <Button variant="primary" onClick={reactivate} disabled={busy}>
            <RotateCcw className="h-4 w-4" /> {busy ? t("settings:plan.reactivating") : t("settings:plan.reactivate")}
          </Button>
        ) : (
          <Button variant="danger" onClick={cancel} disabled={busy || !cur.plan_id}>
            <XCircle className="h-4 w-4" /> {busy ? t("settings:plan.cancelling") : t("settings:plan.cancel")}
          </Button>
        )}
      </div>
    </Card>
  );
}

function UsageLine({ label, used, max }: { label: string; used: number; max: number }) {
  const { t } = useTranslation();
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const over = max > 0 && used > max;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="font-mono tabular-nums">{used} {t("settings:plan.of")} {max}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div className={cn("h-full rounded-full transition-all", over ? "bg-danger" : "bg-primary")} style={{ width: `${Math.max(pct, used > 0 ? 4 : 0)}%` }} />
      </div>
    </div>
  );
}

// === Danger Zone: exclusão permanente da empresa (só admin da empresa) ===

function DangerZoneTab() {
  const { t } = useTranslation();
  const [org, setOrg] = useState<OrgSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.get<OrgSummary>("/org").then(setOrg).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>;
  if (!org) return null;

  return (
    <>
      <Card className="border-danger/40">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-danger/15 text-danger">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-danger">{t("settings:danger.title")}</h2>
            <p className="mt-1 text-sm text-muted">{t("settings:danger.intro")}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-danger/30 bg-danger/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t("settings:danger.deleteHeading")}</p>
            <p className="text-xs text-muted">{t("settings:danger.deleteHint", { name: org.name })}</p>
          </div>
          <Button variant="danger" onClick={() => setOpen(true)} className="shrink-0">
            <Trash2 className="h-4 w-4" /> {t("settings:danger.deleteButton")}
          </Button>
        </div>
      </Card>
      {open && <DeleteOrgModal org={org} onClose={() => setOpen(false)} />}
    </>
  );
}

function DeleteOrgModal({ org, onClose }: { org: OrgSummary; onClose: () => void }) {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const toast = useToast();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  // Alerta de plano vigente: "active" (ou "canceled", que ainda vale até o vencimento).
  const hasActivePlan = org.plan_status === "active" || org.plan_status === "canceled";
  const canDelete = confirm.trim() === org.name || confirm.trim().toUpperCase() === "EXCLUIR";

  async function remove() {
    if (!canDelete || busy) return;
    setBusy(true);
    try {
      await api.post("/org/delete", { confirm: confirm.trim() });
      // O logout recarrega a página, então o toast some antes de aparecer.
      // Sinaliza p/ a tela de login mostrar o popup de sucesso após o redirect.
      sessionStorage.setItem("aurora_account_deleted", "1");
      logout(); // limpa o token e redireciona para /login
    } catch (e) {
      toast.error(e instanceof ApiError ? e : t("settings:danger.failed"), { title: t("settings:danger.failed") });
      setBusy(false);
    }
  }

  const entities: { k: string; n: number }[] = [
    { k: "devices", n: org.counts.devices },
    { k: "sites", n: org.counts.sites },
    { k: "users", n: org.counts.users },
    { k: "credentials", n: org.counts.credentials },
    { k: "backups", n: org.counts.backups },
  ];

  return (
    <Modal
      title={t("settings:danger.modal.title")}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common:actions.cancel")}</Button>
          <Button variant="danger" onClick={remove} disabled={busy || !canDelete}>
            {busy
              ? <><Spinner className="h-4 w-4" /> {t("settings:danger.modal.deleting")}</>
              : <><Trash2 className="h-4 w-4" /> {t("settings:danger.modal.confirmButton")}</>}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{t("settings:danger.modal.irreversible", { name: org.name })}</p>
        </div>

        {hasActivePlan && (
          <div className="flex items-start gap-2 rounded-lg border border-accent/40 bg-accent/10 p-3 text-sm text-accent">
            <CreditCard className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">{t("settings:danger.modal.planWarnTitle", { plan: org.plan_name ?? "" })}</p>
              <p className="mt-1 text-xs opacity-90">{t("settings:danger.modal.planWarnBody")}</p>
            </div>
          </div>
        )}

        <div>
          <p className="mb-2 text-xs uppercase tracking-wide text-muted">{t("settings:danger.modal.willDelete")}</p>
          <ul className="grid grid-cols-2 gap-1.5 text-sm">
            {entities.map((it) => (
              <li key={it.k} className="flex items-center justify-between rounded-md bg-surface-2 px-2.5 py-1.5">
                <span className="text-muted">{t(`settings:danger.entities.${it.k}`)}</span>
                <span className="font-mono tabular-nums">{it.n}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">{t("settings:danger.modal.plusMore")}</p>
        </div>

        <div className="space-y-1">
          <label htmlFor="del-confirm" className="text-xs text-muted">{t("settings:danger.modal.confirmLabel", { name: org.name })}</label>
          <Input id="del-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={org.name} disabled={busy} autoFocus />
        </div>
      </div>
    </Modal>
  );
}

// === Meu Perfil: e-mail (login, não editável), telefone, foto e troca de senha ===

/** Redimensiona a imagem para um avatar pequeno (data URL JPEG). */
function resizeImage(file: File, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("canvas"));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function ProfileTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const { user, refresh } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [doc, setDoc] = useState(maskCpfCnpj(user?.document ?? ""));
  const [savingInfo, setSavingInfo] = useState(false);
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => { setPhone(user?.phone ?? ""); }, [user]);
  useEffect(() => { setDoc(maskCpfCnpj(user?.document ?? "")); }, [user]);

  async function patchProfile(patch: Record<string, unknown>, okMsg: string) {
    setSavingInfo(true);
    try {
      await api.patch("/profile", patch);
      await refresh();
      toast.success(okMsg);
    } catch (e) {
      toast.error(e instanceof ApiError ? e : t("profile:saveFailed"), { title: t("profile:saveFailed") });
    } finally {
      setSavingInfo(false);
    }
  }

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await resizeImage(file, 256);
      await patchProfile({ photo: dataUrl }, t("profile:photoUpdated"));
    } catch {
      toast.error(t("profile:photoFailed"), { title: t("profile:photoFailed") });
    }
  }

  async function changePassword() {
    const pe = passwordError(newPw);
    if (pe) { toast.error(t(pe)); return; }
    if (newPw !== newPw2) { toast.error(t("profile:password.mismatch")); return; }
    setSavingPw(true);
    try {
      await api.post("/profile/password", { old_password: oldPw, new_password: newPw });
      setOldPw(""); setNewPw(""); setNewPw2("");
      toast.success(t("profile:password.changed"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e : t("profile:password.failed"), { title: t("profile:password.failed") });
    } finally {
      setSavingPw(false);
    }
  }

  const initial = (user?.email ?? "?").charAt(0).toUpperCase();
  const phoneChanged = phone !== (user?.phone ?? "");
  const docNorm = normalizeDoc(doc);
  const docChanged = docNorm !== (user?.document ?? "");
  // Vazio é permitido (só será exigido no checkout); senão precisa ser CPF/CNPJ válido.
  const docValid = docNorm.length === 0 || isValidCpfCnpj(docNorm);

  const role = user?.role ?? "operator";

  return (
    <div className="mx-auto max-w-xl space-y-5">
      {/* Cartão do perfil — avatar centralizado + identidade */}
      <Card>
        <div className="flex flex-col items-center text-center">
          <div className="relative">
            {user?.photo ? (
              <img src={user.photo} alt="" className="h-24 w-24 rounded-full object-cover ring-2 ring-border" />
            ) : (
              <div className="grid h-24 w-24 place-items-center rounded-full bg-primary/15 text-3xl font-semibold text-primary ring-2 ring-border">{initial}</div>
            )}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={savingInfo}
              className="absolute bottom-0 right-0 grid h-8 w-8 place-items-center rounded-full border border-border bg-surface-2 text-muted shadow-sm hover:text-primary cursor-pointer"
              aria-label={t("profile:changePhoto")}
            >
              <Camera className="h-4 w-4" />
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickPhoto} />
          </div>
          <p className="mt-3 max-w-full truncate text-base font-semibold">{user?.email}</p>
          <Badge tone={role === "master" ? "accent" : role === "admin" ? "primary" : "muted"}>{t(`common:roles.${role}`)}</Badge>
          <p className="mt-2 text-[11px] text-muted">{t("profile:photoHint")}</p>
          {user?.photo && (
            <button type="button" onClick={() => patchProfile({ photo: "" }, t("profile:photoRemoved"))} className="mt-0.5 text-[11px] text-danger/80 hover:text-danger cursor-pointer">
              {t("profile:removePhoto")}
            </button>
          )}
        </div>

        {/* E-mail (login, travado) + telefone */}
        <div className="mt-6 space-y-4 border-t border-border pt-5">
          <div className="space-y-1">
            <label className="text-xs text-muted">{t("profile:email")}</label>
            <Input value={user?.email ?? ""} disabled />
            <p className="text-[11px] text-muted">{t("profile:emailLocked")}</p>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted">{t("profile:phone")}</label>
            <div className="flex gap-2">
              <MaskedInput mask="phone" value={phone} onValueChange={setPhone} className="flex-1 font-mono" />
              <Button variant="ghost" onClick={() => patchProfile({ phone }, t("profile:saved"))} disabled={savingInfo || !phoneChanged}>
                <Save className="h-4 w-4" /> {t("common:actions.save")}
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted">{t("profile:document")}</label>
            <div className="flex gap-2">
              <MaskedInput mask="document" value={doc} onValueChange={setDoc} placeholder={t("profile:documentPlaceholder")}
                className={cn("flex-1 font-mono", doc && !docValid && "border-danger")} />
              <Button variant="ghost" onClick={() => patchProfile({ document: doc }, t("profile:saved"))} disabled={savingInfo || !docChanged || !docValid}>
                <Save className="h-4 w-4" /> {t("common:actions.save")}
              </Button>
            </div>
            <p className="text-[11px] text-muted">{t("profile:documentHint")}</p>
          </div>
        </div>
      </Card>

      {/* Cartão de senha (exige a senha atual) */}
      <Card>
        <div className="mb-4 flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">{t("profile:password.title")}</h2>
        </div>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted">{t("profile:password.current")}</label>
            <Input type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted">{t("profile:password.new")}</label>
            <Input type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)}
              className={cn(newPw && (passwordError(newPw) ? "border-danger" : "border-emerald-500"))} />
            <p className={cn("text-[11px]", newPw && passwordError(newPw) ? "text-danger" : newPw ? "text-emerald-500" : "text-muted")}>{t(PASSWORD_HINT_KEY)}</p>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted">{t("profile:password.confirm")}</label>
            <Input type="password" autoComplete="new-password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)}
              className={cn(newPw2 && (newPw2 === newPw ? "border-emerald-500" : "border-danger"))} />
            {newPw2 && newPw2 !== newPw && <p className="text-[11px] text-danger">{t("profile:password.mismatch")}</p>}
          </div>
          <Button className="w-full justify-center" onClick={changePassword} disabled={savingPw || !oldPw || !newPw || newPw !== newPw2 || !!passwordError(newPw)}>
            {savingPw ? t("common:actions.saving") : t("profile:password.submit")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
