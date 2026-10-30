import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, map } from 'rxjs';
import { ApiError } from '../core/api/api.error';

export interface BridgeEvent {
  schema: string;
  id: string;
  seq: number;
  type: string;
  session_id: string;
  turn_id?: string | null;
  payload: Record<string, unknown>;
  provider: string;
}

export interface BridgeSession {
  id: string;
  provider: string;
  state: string;
  product_id?: string | null;
  resumable?: boolean;
}

export interface BridgeProvider {
  id: string;
  name: string;
  installed?: boolean;
  executable?: string | null;
  auth_state: string;
  capabilities: { name: string; state: string }[];
}

const BRIDGE_URL_KEY = 'fab.baseUrl';
const BRIDGE_TOKEN_KEY = 'fab.pairToken';

function read(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Client for the Forge Agent Bridge LOCAL service (127.0.0.1, paired). */
@Injectable({ providedIn: 'root' })
export class PfBridge {
  private readonly http = inject(HttpClient);
  readonly baseUrl = signal(read(BRIDGE_URL_KEY) ?? 'http://127.0.0.1:8471');
  readonly token = signal(read(BRIDGE_TOKEN_KEY) ?? '');

  setPairing(token: string, baseUrl?: string): void {
    this.token.set(token.trim());
    if (baseUrl) this.baseUrl.set(baseUrl.trim().replace(/\/+$/, ''));
    try {
      globalThis.localStorage?.setItem(BRIDGE_TOKEN_KEY, this.token());
      globalThis.localStorage?.setItem(BRIDGE_URL_KEY, this.baseUrl());
    } catch {
      /* storage unavailable */
    }
  }

  private url(p: string): string {
    return `${this.baseUrl()}${p}`;
  }
  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.token()}`, 'Content-Type': 'application/json' };
  }
  private fail(e: unknown): never {
    if (e instanceof HttpErrorResponse) throw new ApiError(e.status, e.error?.error);
    throw new ApiError(0);
  }
  private post<T>(p: string, body: unknown): Observable<T> {
    return this.http
      .post<T>(this.url(p), body, { headers: this.headers() })
      .pipe(catchError((e) => this.fail(e)));
  }
  private get<T>(p: string): Observable<T> {
    return this.http
      .get<T>(this.url(p), { headers: this.headers() })
      .pipe(catchError((e) => this.fail(e)));
  }

  providers() {
    return this.get<{ items: BridgeProvider[] }>('/providers').pipe(map((r) => r.items));
  }
  createSession(provider: string, productId?: string) {
    return this.post<BridgeSession>('/agent-sessions', {
      provider,
      product_id: productId ?? null,
    });
  }
  prompt(sessionId: string, provider: string, text: string) {
    return this.post<{ accepted: boolean }>(`/agent-sessions/${sessionId}/prompt`, {
      text,
      provider,
    });
  }
  events(sessionId: string, provider: string, afterSeq = 0) {
    return this.post<{ items: BridgeEvent[] }>(`/agent-sessions/${sessionId}/events`, {
      provider,
      after_seq: afterSeq,
    });
  }
  cancel(sessionId: string, provider: string) {
    return this.post<{ cancelled: boolean }>(`/agent-sessions/${sessionId}/cancel`, {
      provider,
    });
  }
}
