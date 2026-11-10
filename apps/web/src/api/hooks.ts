import type { AiStatus, CaseHistoryEntry, Dashboard, Project, Run, RunDetail, Suite, TestCase } from "@hub/shared";
import { useQuery } from "@tanstack/react-query";
import { api, toQuery } from "./client";

export interface CaseListFilter {
  suiteId?: number | undefined;
  platforms?: string[];
  types?: string[];
  statuses?: string[];
  tags?: string[];
  q?: string;
  needsReview?: boolean | undefined;
}

export const keys = {
  projects: ["projects"] as const,
  project: (id: number) => ["projects", id] as const,
  suites: (projectId: number) => ["projects", projectId, "suites"] as const,
  cases: (projectId: number) => ["projects", projectId, "cases"] as const,
  caseList: (projectId: number, filter: CaseListFilter) => ["projects", projectId, "cases", filter] as const,
  tags: (projectId: number) => ["projects", projectId, "tags"] as const,
  runs: (projectId: number) => ["projects", projectId, "runs"] as const,
  dashboard: (projectId: number) => ["projects", projectId, "dashboard"] as const,
  case: (id: number) => ["cases", id] as const,
  caseHistory: (id: number) => ["cases", id, "history"] as const,
  run: (id: number) => ["runs", id] as const,
  aiStatus: ["ai", "status"] as const,
};

export const useProjects = () =>
  useQuery({ queryKey: keys.projects, queryFn: () => api.get<Project[]>("/api/projects") });

export const useSuites = (projectId: number) =>
  useQuery({ queryKey: keys.suites(projectId), queryFn: () => api.get<Suite[]>(`/api/projects/${projectId}/suites`) });

export const useCases = (projectId: number, filter: CaseListFilter = {}) =>
  useQuery({
    queryKey: keys.caseList(projectId, filter),
    queryFn: () =>
      api.get<TestCase[]>(
        `/api/projects/${projectId}/cases${toQuery({
          suiteId: filter.suiteId,
          platforms: filter.platforms,
          types: filter.types,
          statuses: filter.statuses,
          tags: filter.tags,
          q: filter.q,
          needsReview: filter.needsReview,
        })}`,
      ),
    placeholderData: (previous) => previous,
  });

export const useTags = (projectId: number) =>
  useQuery({ queryKey: keys.tags(projectId), queryFn: () => api.get<string[]>(`/api/projects/${projectId}/tags`) });

export const useCase = (id: number | null) =>
  useQuery({
    queryKey: keys.case(id ?? 0),
    queryFn: () => api.get<TestCase>(`/api/cases/${id}`),
    enabled: id !== null,
  });

export const useCaseHistory = (id: number | null) =>
  useQuery({
    queryKey: keys.caseHistory(id ?? 0),
    queryFn: () => api.get<CaseHistoryEntry[]>(`/api/cases/${id}/history`),
    enabled: id !== null,
  });

export const useRuns = (projectId: number) =>
  useQuery({ queryKey: keys.runs(projectId), queryFn: () => api.get<Run[]>(`/api/projects/${projectId}/runs`) });

export const useRun = (id: number) =>
  useQuery({ queryKey: keys.run(id), queryFn: () => api.get<RunDetail>(`/api/runs/${id}`) });

export const useDashboard = (projectId: number) =>
  useQuery({
    queryKey: keys.dashboard(projectId),
    queryFn: () => api.get<Dashboard>(`/api/projects/${projectId}/dashboard`),
  });

export const useAiStatus = () =>
  useQuery({ queryKey: keys.aiStatus, queryFn: () => api.get<AiStatus>("/api/ai/status"), staleTime: Infinity });
