import type { Project } from "@hub/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { NavLink, Outlet, useNavigate, useParams } from "react-router";
import { api, errorMessage } from "../api/client";
import { keys, useAiStatus, useProjects } from "../api/hooks";
import { getTesterName, setTesterName } from "../lib/format";
import { Alert, Button } from "./ui";

const NAV = [
  { to: "dashboard", label: "Dashboard", icon: "▦" },
  { to: "cases", label: "Test cases", icon: "☰" },
  { to: "runs", label: "Test runs", icon: "▶" },
  { to: "import", label: "Import results", icon: "⇪" },
  { to: "ai", label: "AI test design", icon: "✦" },
];

export function useProjectId(): number {
  const { projectId } = useParams();
  return Number(projectId);
}

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: () => api.post<Project>("/api/projects", { name, description: "" }),
    onSuccess: async (p) => {
      await qc.invalidateQueries({ queryKey: keys.projects });
      onClose();
      void navigate(`/p/${p.id}/cases`);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <form className="inline-form" onSubmit={submit} aria-label="New project">
      <label htmlFor="new-project-name" className="sr-only">
        Project name
      </label>
      <input
        id="new-project-name"
        autoFocus
        placeholder="Project name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="row">
        <Button type="submit" variant="primary" size="sm" disabled={!name.trim() || create.isPending}>
          Create
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
      {create.isError && <Alert>{errorMessage(create.error)}</Alert>}
    </form>
  );
}

export function Layout() {
  const projectId = useProjectId();
  const projects = useProjects();
  const ai = useAiStatus();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [tester, setTester] = useState(getTesterName);
  const testerTimer = useRef<number | undefined>(undefined);

  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Sidebar">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span>
            Test Hub <small>AI-assisted test management</small>
          </span>
        </div>

        <div className="field compact">
          <label htmlFor="project-select">Project</label>
          <select
            id="project-select"
            value={projectId || ""}
            onChange={(e) => void navigate(`/p/${e.target.value}/dashboard`)}
          >
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {creating ? (
            <NewProjectDialog onClose={() => setCreating(false)} />
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
              + New project
            </Button>
          )}
        </div>

        <nav aria-label="Main navigation">
          <ul>
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink to={`/p/${projectId}/${n.to}`} className={({ isActive }) => (isActive ? "active" : "")}>
                  <span className="nav-icon" aria-hidden="true">
                    {n.icon}
                  </span>
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="sidebar-footer">
          <div className="field compact">
            <label htmlFor="tester-name">Your name (for results)</label>
            <input
              id="tester-name"
              value={tester}
              placeholder="e.g. Dana K."
              onChange={(e) => {
                const v = e.target.value;
                setTester(v);
                window.clearTimeout(testerTimer.current);
                testerTimer.current = window.setTimeout(() => setTesterName(v), 300);
              }}
            />
          </div>
          {ai.data && (
            <p className="provider" title="Set ANTHROPIC_API_KEY on the server to use Claude">
              AI provider: <strong>{ai.data.provider === "mock" ? "offline mock" : "Claude"}</strong>
              <br />
              <code>{ai.data.model}</code>
            </p>
          )}
        </div>
      </aside>
      <main id="main" className="main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
