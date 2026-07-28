import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, Check, CheckCheck } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type { AppNotification } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Button, Card, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

/** Avisa o menu lateral para reavaliar o contador de não lidas. */
function notifyChanged() {
  window.dispatchEvent(new CustomEvent("notifications:changed"));
}

export function Notifications() {
  const { t } = useTranslation();
  const toast = useToast();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<AppNotification[]>("/notifications").then(setItems).catch(() => setItems([]));
  }, []);

  const unread = (items ?? []).filter((n) => !n.read).length;

  async function markRead(id: number) {
    // Otimista: marca localmente e sincroniza o contador do menu.
    setItems((prev) => prev?.map((n) => (n.id === id ? { ...n, read: true } : n)) ?? prev);
    notifyChanged();
    try {
      await api.post(`/notifications/${id}/read`);
    } catch {
      // Em caso de falha, recarrega para refletir o estado real.
      api.get<AppNotification[]>("/notifications").then(setItems);
    }
  }

  async function markAll() {
    setBusy(true);
    try {
      await api.post("/notifications/read-all");
      setItems((prev) => prev?.map((n) => ({ ...n, read: true })) ?? prev);
      notifyChanged();
      toast.success(t("notifications:allReadDone"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e : t("notifications:actionFailed"), { title: t("notifications:actionFailed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={t("notifications:title")}
        subtitle={t("notifications:subtitle")}
        actions={
          unread > 0 ? (
            <Button variant="ghost" onClick={markAll} disabled={busy}>
              <CheckCheck className="h-4 w-4" /> {t("notifications:markAll")}
            </Button>
          ) : undefined
        }
      />

      {items === null ? (
        <div className="flex justify-center py-16"><Spinner className="h-6 w-6" /></div>
      ) : items.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Bell className="h-8 w-8 text-muted" />
            <p className="text-sm text-muted">{t("notifications:empty")}</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((n) => (
            <Card
              key={n.id}
              className={cn("flex items-start gap-3 transition-colors", !n.read && "border-primary/40 bg-primary/5")}
            >
              <span className="mt-1.5 flex h-2.5 w-2.5 shrink-0 items-center justify-center">
                {!n.read && <span className="h-2.5 w-2.5 rounded-full bg-primary" aria-label={t("notifications:unread")} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className={cn("truncate text-sm", n.read ? "font-medium" : "font-semibold")}>{n.title}</p>
                  {n.created_at && (
                    <span className="shrink-0 text-xs text-muted">{new Date(n.created_at).toLocaleString()}</span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-muted">{n.body}</p>
              </div>
              {!n.read && (
                <button
                  onClick={() => markRead(n.id)}
                  className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-primary cursor-pointer"
                  title={t("notifications:markRead")}
                  aria-label={t("notifications:markRead")}
                >
                  <Check className="h-4 w-4" />
                </button>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
