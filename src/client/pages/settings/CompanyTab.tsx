import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button, ErrorBox, Field, Input, Loading, useToast } from "../../components/ui";
import { errorMessage, get, put } from "../../lib/api";
import { queryClient } from "../../lib/queries";
import { SectionHeader } from "./common";

export function CompanyTab() {
  const toast = useToast();
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => get<Record<string, string>>("/settings"),
  });
  const current = settings.data?.company_name ?? "";
  const [name, setName] = useState("");
  useEffect(() => {
    if (settings.data) setName(settings.data.company_name ?? "");
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => put("/settings", { companyName: name.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      toast("会社名を保存しました");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const trimmed = name.trim();
  const error = settings.data && !trimmed ? "会社名を入力してください" : null;

  return (
    <div>
      <SectionHeader title="会社情報" description="画面左上のメニューなど、アプリ内に表示する会社名です。" />
      {settings.isLoading && <Loading />}
      {settings.error && <ErrorBox error={settings.error} onRetry={() => settings.refetch()} />}
      {settings.data && (
        <form
          className="max-w-xl rounded-lg border border-line bg-white p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!error) save.mutate();
          }}
        >
          <Field label="会社名" required htmlFor="co-name" error={error} help="60文字以内">
            <Input
              id="co-name"
              value={name}
              maxLength={60}
              aria-invalid={error ? true : undefined}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div className="mt-4 flex items-center gap-3">
            <Button
              type="submit"
              variant="primary"
              loading={save.isPending}
              disabled={!!error || trimmed === current}
            >
              保存
            </Button>
            {trimmed !== current && !error && (
              <Button variant="ghost" onClick={() => setName(current)}>
                元に戻す
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
