import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui";

export function ComingSoon({ title, hint }: { title: string; hint?: string }) {
  const { t } = useTranslation();
  return (
    <div>
      <PageHeader title={title} />
      <Card className="flex flex-col items-center justify-center gap-1 py-16 text-center">
        <p className="text-sm font-medium">{t("common:comingSoon.badge")}</p>
        <p className="text-xs text-muted">{hint ?? t("common:comingSoon.hint")}</p>
      </Card>
    </div>
  );
}
