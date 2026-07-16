import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui";

export function ComingSoon({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <PageHeader title={title} />
      <Card className="flex flex-col items-center justify-center gap-1 py-16 text-center">
        <p className="text-sm font-medium">Em breve</p>
        <p className="text-xs text-muted">{hint ?? "Esta tela está em construção."}</p>
      </Card>
    </div>
  );
}
