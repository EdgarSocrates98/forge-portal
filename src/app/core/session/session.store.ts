import { Injectable, signal } from '@angular/core';

/**
 * Local session for the portal server. The CLI opens the browser at
 * `/?forge_session=<token>`; we lift the token into memory (never
 * persisted to storage so it dies with the tab), strip it from the URL,
 * and attach it as `X-Forge-Session` on every API call. The server also
 * sets a SameSite=Strict cookie for defense in depth.
 */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly tokenSignal = signal<string | null>(null);
  readonly token = this.tokenSignal.asReadonly();

  constructor() {
    const url = new URL(globalThis.location.href);
    const fromUrl = url.searchParams.get('forge_session');
    if (fromUrl) {
      this.tokenSignal.set(fromUrl);
      url.searchParams.delete('forge_session');
      globalThis.history.replaceState(null, '', url.toString());
      return;
    }
    // Dev-mode fallback (ng serve without the python backend): allow an
    // explicit header override for local development only.
    const dev = url.searchParams.get('dev_session');
    if (dev) this.tokenSignal.set(dev);
  }

  hasSession(): boolean {
    return this.tokenSignal() !== null;
  }
}
