import { Routes } from '@angular/router';

/**
 * Product Forge Studio — lazy route group mounted at `/pf`.
 * `products/:pid` renders the detail shell; the eight product surfaces
 * (context|knowledge|agents|analytics|dashboards|planning|apis|reports)
 * are tabs inside it, deep-linkable via `?tab=`.
 */
export const PF_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/home.page').then((m) => m.PfHomePage),
  },
  {
    path: 'products',
    loadComponent: () => import('./pages/products.page').then((m) => m.PfProductsPage),
  },
  {
    path: 'products/:pid',
    loadComponent: () =>
      import('./pages/product-detail.page').then((m) => m.PfProductDetailPage),
  },
  {
    path: 'settings',
    loadComponent: () => import('./pages/settings.page').then((m) => m.PfSettingsPage),
  },
  {
    path: 'chat',
    loadComponent: () => import('./pages/chat.page').then((m) => m.PfChatPage),
  },
  {
    path: 'control-center',
    loadComponent: () =>
      import('./pages/control-center.page').then((m) => m.PfControlCenterPage),
  },
  {
    path: 'compare',
    loadComponent: () =>
      import('./pages/compare.page').then((m) => m.PfComparePage),
  },
  {
    path: 'lens',
    loadComponent: () => import('./pages/lens.page').then((m) => m.PfLensPage),
  },
  {
    path: 'artifacts',
    loadComponent: () =>
      import('./pages/artifact-studio.page').then((m) => m.PfArtifactStudioPage),
  },
  {
    path: 'workflows',
    loadComponent: () =>
      import('./pages/workflow.page').then((m) => m.PfWorkflowPage),
  },
  {
    path: 'templates',
    loadComponent: () =>
      import('./pages/templates.page').then((m) => m.PfTemplatesPage),
  },
  {
    path: 'intelligence',
    loadComponent: () =>
      import('./pages/intel-actions.page').then((m) => m.PfIntelActionsPage),
  },
  {
    path: 'onboarding',
    loadComponent: () => import('./pages/onboarding.page').then((m) => m.PfOnboardingPage),
  },
  { path: '**', redirectTo: '' },
];
