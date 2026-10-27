import { type ComponentType, lazy, Suspense } from "react";
import { createBrowserRouter, Navigate, Outlet, useLocation, useRouteError } from "react-router";
import { AppShell } from "./components/AppShell";
import { Button, Loading } from "./components/ui";
import { ApiError } from "./lib/api";
import { useMe } from "./lib/queries";
import { LoginPage } from "./pages/LoginPage";

function page(loader: () => Promise<{ default: ComponentType }>) {
  const C = lazy(loader);
  return (
    <Suspense fallback={<Loading />}>
      <C />
    </Suspense>
  );
}

function RequireAuth() {
  const me = useMe();
  const location = useLocation();
  if (me.isLoading) return <Loading label="読み込んでいます" />;
  if (me.error instanceof ApiError && me.error.status === 401) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  if (!me.data) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <div className="text-center">
          <p className="mb-3 text-sm text-ink-2">サーバーに接続できませんでした。</p>
          <Button onClick={() => me.refetch()}>再読み込み</Button>
        </div>
      </div>
    );
  }
  return <Outlet />;
}

function RouteError() {
  const err = useRouteError();
  const isChunk =
    err instanceof Error && /dynamically imported module|Importing a module script failed/.test(err.message);
  return (
    <div className="flex min-h-[60dvh] items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="mb-2 text-lg font-bold">
          {isChunk ? "新しいバージョンがあります" : "画面を表示できませんでした"}
        </h1>
        <p className="mb-4 text-sm text-ink-2">
          {isChunk
            ? "アプリが更新されました。再読み込みすると最新の画面を表示します。"
            : err instanceof Error
              ? err.message
              : "時間をおいて再度お試しください。"}
        </p>
        <Button variant="primary" onClick={() => window.location.reload()}>
          再読み込み
        </Button>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="py-20 text-center">
      <h1 className="mb-2 text-lg font-bold">ページが見つかりません</h1>
      <p className="text-sm text-ink-2">URL が正しいか確認してください。</p>
    </div>
  );
}

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage />, errorElement: <RouteError /> },
  {
    element: <RequireAuth />,
    errorElement: <RouteError />,
    children: [
      {
        element: <AppShell />,
        errorElement: <RouteError />,
        children: [
          { index: true, element: page(() => import("./pages/HomePage")) },
          { path: "members", element: page(() => import("./pages/members/MembersPage")) },
          { path: "members/compare", element: page(() => import("./pages/members/ComparePage")) },
          { path: "members/:id", element: page(() => import("./pages/members/MemberProfilePage")) },
          { path: "org", element: page(() => import("./pages/org/OrgTreePage")) },
          { path: "lists", element: page(() => import("./pages/lists/MemberListsPage")) },
          { path: "lists/:id", element: page(() => import("./pages/lists/MemberListDetailPage")) },
          { path: "skills", element: page(() => import("./pages/talent/SkillsPage")) },
          { path: "positions", element: page(() => import("./pages/talent/PositionsPage")) },
          { path: "positions/:id", element: page(() => import("./pages/talent/PositionDetailPage")) },
          { path: "placement", element: page(() => import("./pages/placement/PlacementListPage")) },
          { path: "placement/:id", element: page(() => import("./pages/placement/PlacementEditorPage")) },
          { path: "balance", element: page(() => import("./pages/placement/BalancePage")) },
          { path: "boards", element: page(() => import("./pages/boards/BoardsPage")) },
          { path: "boards/:id", element: page(() => import("./pages/boards/BoardEditorPage")) },
          { path: "evaluations", element: page(() => import("./pages/evaluations/EvaluationsPage")) },
          {
            path: "evaluations/sheets/:id",
            element: page(() => import("./pages/evaluations/EvaluationSheetPage")),
          },
          {
            path: "evaluations/periods/:id",
            element: page(() => import("./pages/evaluations/EvaluationPeriodPage")),
          },
          {
            path: "evaluations/templates/:id",
            element: page(() => import("./pages/evaluations/EvaluationTemplatePage")),
          },
          { path: "surveys", element: page(() => import("./pages/surveys/SurveysPage")) },
          { path: "surveys/:id", element: page(() => import("./pages/surveys/SurveyDetailPage")) },
          { path: "surveys/:id/answer", element: page(() => import("./pages/surveys/SurveyAnswerPage")) },
          { path: "surveys/:id/edit", element: page(() => import("./pages/surveys/SurveyEditPage")) },
          { path: "one-on-ones", element: page(() => import("./pages/oneonones/OneOnOnesPage")) },
          { path: "requests", element: page(() => import("./pages/requests/RequestsPage")) },
          { path: "dashboard", element: page(() => import("./pages/analytics/DashboardPage")) },
          { path: "analytics", element: page(() => import("./pages/analytics/AnalyticsPage")) },
          { path: "settings", element: page(() => import("./pages/settings/SettingsPage")) },
          { path: "settings/:tab", element: page(() => import("./pages/settings/SettingsPage")) },
          { path: "account", element: page(() => import("./pages/AccountPage")) },
          { path: "*", element: <NotFound /> },
        ],
      },
    ],
  },
]);
