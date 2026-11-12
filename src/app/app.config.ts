import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import {
  PreloadAllModules,
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withPreloading,
  withViewTransitions,
} from '@angular/router';
import { provideHttpClient, withInterceptors, withFetch } from '@angular/common/http';
import { routes } from './app.routes';
import { forgeApiInterceptor } from './core/api/api.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      // Lazy chunks are prefetched right after first paint — portal pages
      // feel local because navigation almost never waits on a bundle.
      withPreloading(PreloadAllModules),
      // Smooth cross-fade between routed views; honours reduced-motion
      // (the transition CSS in styles.css gates on the media query).
      withViewTransitions(),
      // `#host-<id>` fragment links (MCP registry, agent detail) scroll to
      // real anchors; back/forward restores the scroll position.
      withInMemoryScrolling({
        anchorScrolling: 'enabled',
        scrollPositionRestoration: 'enabled',
      }),
    ),
    provideHttpClient(withFetch(), withInterceptors([forgeApiInterceptor])),
  ],
};
