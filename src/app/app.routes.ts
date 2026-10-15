import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'dashboard',
    loadComponent: () => import('./pages/dashboard/dashboard.page').then((m) => m.DashboardPage),
  },
  {
    path: 'install',
    loadComponent: () => import('./pages/install/install.page').then((m) => m.InstallPage),
  },
  {
    path: 'config',
    loadComponent: () => import('./pages/config/config.page').then((m) => m.ConfigPage),
  },
  {
    path: 'forges',
    loadComponent: () => import('./pages/explorer/explorer.page').then((m) => m.ExplorerPage),
  },
  {
    path: 'forges/:id',
    loadComponent: () =>
      import('./pages/explorer/forge-detail.page').then((m) => m.ForgeDetailPage),
  },
  {
    path: 'match',
    loadComponent: () => import('./pages/match/match.page').then((m) => m.MatchPage),
  },
  {
    path: 'federation',
    loadComponent: () => import('./pages/federation/federation.page').then((m) => m.FederationPage),
  },
  {
    path: 'profiles',
    loadComponent: () => import('./pages/profiles/profiles.page').then((m) => m.ProfilesPage),
  },
  {
    path: 'hosts',
    loadComponent: () => import('./pages/hosts/hosts.page').then((m) => m.HostsPage),
  },
  {
    path: 'mcp',
    loadComponent: () => import('./pages/mcp/mcp.page').then((m) => m.McpPage),
  },
  {
    path: 'skills',
    loadComponent: () => import('./pages/skills/skills.page').then((m) => m.SkillsPage),
  },
  {
    path: 'agents',
    loadComponent: () => import('./pages/agents/agents.page').then((m) => m.AgentsPage),
  },
  {
    path: 'tasks',
    loadComponent: () => import('./pages/tasks/tasks.page').then((m) => m.TasksPage),
  },
  {
    path: 'graph',
    loadComponent: () => import('./pages/graph/graph.page').then((m) => m.GraphPage),
  },
  {
    path: 'observe',
    loadComponent: () => import('./pages/observe/observe.page').then((m) => m.ObservePage),
  },
  {
    path: 'lab',
    loadComponent: () => import('./pages/lab/lab.page').then((m) => m.LabPage),
  },
  {
    path: 'versions',
    loadComponent: () => import('./pages/versions/versions.page').then((m) => m.VersionsPage),
  },
  {
    path: 'knowledge',
    loadComponent: () => import('./pages/knowledge/knowledge.page').then((m) => m.KnowledgePage),
  },
  {
    path: 'settings',
    loadComponent: () => import('./pages/settings/settings.page').then((m) => m.SettingsPage),
  },
  { path: '**', redirectTo: 'dashboard' },
];
