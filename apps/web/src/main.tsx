import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { useProjects } from "./api/hooks";
import { Layout } from "./components/Layout";
import { Alert, Loading } from "./components/ui";
import { AiGeneratePage } from "./pages/AiGenerate";
import { CaseEditorPage } from "./pages/CaseEditor";
import { CasesPage } from "./pages/Cases";
import { DashboardPage } from "./pages/Dashboard";
import { ImportPage } from "./pages/Import";
import { NewRunPage } from "./pages/NewRun";
import { RunDetailPage } from "./pages/RunDetail";
import { RunsPage } from "./pages/Runs";
import "./styles.css";

function Home() {
  const projects = useProjects();
  if (projects.isPending) return <Loading />;
  if (projects.isError) return <Alert>Could not reach the API. Is the server running?</Alert>;
  const first = projects.data[0];
  return first ? <Navigate to={`/p/${first.id}/dashboard`} replace /> : <FirstProject />;
}

function FirstProject() {
  return (
    <div className="welcome">
      <h1>Welcome to Test Hub</h1>
      <p>
        There are no projects yet. Load the demo with <code>npm run seed</code>, or create one with{" "}
        <code>POST /api/projects</code>.
      </p>
    </div>
  );
}

const router = createBrowserRouter([
  { path: "/", element: <Home /> },
  {
    path: "/p/:projectId",
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="dashboard" replace /> },
      { path: "dashboard", element: <DashboardPage /> },
      { path: "cases", element: <CasesPage /> },
      { path: "cases/new", element: <CaseEditorPage /> },
      { path: "cases/:caseId", element: <CaseEditorPage /> },
      { path: "runs", element: <RunsPage /> },
      { path: "runs/new", element: <NewRunPage /> },
      { path: "runs/:runId", element: <RunDetailPage /> },
      { path: "import", element: <ImportPage /> },
      { path: "ai", element: <AiGeneratePage /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
