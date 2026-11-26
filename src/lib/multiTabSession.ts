/**
 * Cross-tab session coordination for Last Donkey multiplayer.
 *
 * Security & Isolation Guarantees:
 * - Raw session tokens NEVER leave sessionStorage and are NEVER broadcast across tabs.
 * - Cross-tab messages only carry a non-reversible fingerprint derived from the session token.
 * - Unrelated rooms and different player seats have distinct tokens and therefore distinct
 *   fingerprints — they never collide or interfere with each other.
 * - Closing one tab only releases that tab's local claim and never revokes another tab's session.
 */

const CHANNEL_NAME = 'last_donkey_tab_sync_v1';
const STORAGE_RELAY_KEY = 'last_donkey_tab_sync_relay_v1';

export type TabSyncMessage =
  | {
      kind: 'session_probe';
      tabId: string;
      fingerprint: string;
      probeId: string;
    }
  | {
      kind: 'session_active';
      tabId: string;
      fingerprint: string;
      probeId: string;
    }
  | {
      kind: 'session_claim';
      tabId: string;
      fingerprint: string;
      claimedAt?: number;
    }
  | {
      kind: 'session_release';
      tabId: string;
      fingerprint: string;
    };

export interface TabSyncTransport {
  postMessage: (msg: TabSyncMessage) => void;
  subscribe: (handler: (msg: TabSyncMessage) => void) => () => void;
  close: () => void;
}

export interface ProbeResult {
  activeElsewhere: boolean;
  ownerTabId?: string;
}

/**
 * Computes a deterministic, non-reversible 64-bit hex fingerprint from a session token.
 * Safe for cross-tab coordination without ever transmitting or persisting the raw token
 * outside the tab's own sessionStorage.
 */
export function computeSessionFingerprint(sessionToken: string): string {
  const input = sessionToken.trim();
  // Two independent 32-bit FNV-1a passes with distinct seeds produce a 64-bit hex digest
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch ^ ((i * 31) & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `fp_${part1}${part2}`;
}

function generateTabId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `tab_${crypto.randomUUID()}`;
  }
  return `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function isTabSyncMessage(data: unknown): data is TabSyncMessage {
  if (!data || typeof data !== 'object') return false;
  const candidate = data as Partial<TabSyncMessage>;
  return (
    typeof candidate.kind === 'string' &&
    typeof candidate.tabId === 'string' &&
    typeof candidate.fingerprint === 'string'
  );
}

/**
 * Browser transport preferring BroadcastChannel with automatic localStorage event fallback
 * for browsers/environments where BroadcastChannel is unavailable.
 */
export function createBrowserTabTransport(): TabSyncTransport {
  if (typeof window === 'undefined') {
    return {
      postMessage: () => {},
      subscribe: () => () => {},
      close: () => {},
    };
  }

  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    const listeners = new Set<(msg: TabSyncMessage) => void>();

    channel.onmessage = (event) => {
      if (isTabSyncMessage(event.data)) {
        for (const cb of listeners) cb(event.data);
      }
    };

    return {
      postMessage(msg) {
        try {
          channel.postMessage(msg);
        } catch {
          // Channel may already be closed
        }
      },
      subscribe(handler) {
        listeners.add(handler);
        return () => listeners.delete(handler);
      },
      close() {
        listeners.clear();
        try {
          channel.close();
        } catch {
          // ignore
        }
      },
    };
  }

  // Fallback via localStorage 'storage' events (fires in all other tabs on same origin)
  const listeners = new Set<(msg: TabSyncMessage) => void>();
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_RELAY_KEY || !event.newValue) return;
    try {
      const parsed = JSON.parse(event.newValue) as { msg?: unknown };
      if (isTabSyncMessage(parsed.msg)) {
        for (const cb of listeners) cb(parsed.msg);
      }
    } catch {
      // ignore malformed payloads
    }
  };
  window.addEventListener('storage', onStorage);

  return {
    postMessage(msg) {
      try {
        window.localStorage.setItem(
          STORAGE_RELAY_KEY,
          JSON.stringify({ nonce: `${Date.now()}-${Math.random()}`, msg })
        );
        window.localStorage.removeItem(STORAGE_RELAY_KEY);
      } catch {
        // Ignore storage quota or private mode restrictions
      }
    },
    subscribe(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    close() {
      listeners.clear();
      window.removeEventListener('storage', onStorage);
    },
  };
}

export interface MultiTabSessionCoordinatorOptions {
  tabId?: string;
  transport?: TabSyncTransport;
  onSuperseded?: (info: { fingerprint: string; newOwnerTabId: string }) => void;
}

/**
 * Coordinates single-active-tab ownership per player session fingerprint.
 * Handles duplicate-tab detection, simultaneous tab initialization races, explicit takeover,
 * and safe tab closure without revoking another tab's valid session.
 */
export class MultiTabSessionCoordinator {
  public readonly tabId: string;
  private transport: TabSyncTransport;
  private unsubscribe: () => void;
  private ownedFingerprint: string | null = null;
  private ownedClaimedAt = 0;
  private maxObservedClaimAt = 0;
  private activeProbe: {
    probeId: string;
    fingerprint: string;
    resolve: (res: ProbeResult) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private onSupersededCb?: (info: { fingerprint: string; newOwnerTabId: string }) => void;
  private disposed = false;

  constructor(options: MultiTabSessionCoordinatorOptions = {}) {
    this.tabId = options.tabId ?? generateTabId();
    this.transport = options.transport ?? createBrowserTabTransport();
    this.onSupersededCb = options.onSuperseded;
    this.unsubscribe = this.transport.subscribe((msg) => this.handleMessage(msg));
  }

  public getOwnedFingerprint(): string | null {
    return this.ownedFingerprint;
  }

  private handleMessage(msg: TabSyncMessage): void {
    if (this.disposed || msg.tabId === this.tabId) return;

    switch (msg.kind) {
      case 'session_probe': {
        // If we currently own this session fingerprint, reply immediately so the new tab does not overwrite us.
        if (this.ownedFingerprint === msg.fingerprint) {
          this.transport.postMessage({
            kind: 'session_active',
            tabId: this.tabId,
            fingerprint: msg.fingerprint,
            probeId: msg.probeId,
          });
          return;
        }

        // Simultaneous tab init race: both tabs probing the exact same fingerprint at the same time.
        // Deterministic tie-breaker: lexicographically smaller tabId wins; larger tabId defers.
        if (this.activeProbe && this.activeProbe.fingerprint === msg.fingerprint) {
          if (this.tabId < msg.tabId) {
            this.transport.postMessage({
              kind: 'session_active',
              tabId: this.tabId,
              fingerprint: msg.fingerprint,
              probeId: msg.probeId,
            });
          } else {
            this.finishActiveProbe({ activeElsewhere: true, ownerTabId: msg.tabId });
          }
        }
        break;
      }

      case 'session_active': {
        if (
          this.activeProbe &&
          this.activeProbe.fingerprint === msg.fingerprint &&
          this.activeProbe.probeId === msg.probeId
        ) {
          this.finishActiveProbe({ activeElsewhere: true, ownerTabId: msg.tabId });
        }
        break;
      }

      case 'session_claim': {
        const incomingClaimedAt = typeof msg.claimedAt === 'number' ? msg.claimedAt : 0;
        if (incomingClaimedAt > this.maxObservedClaimAt) {
          this.maxObservedClaimAt = incomingClaimedAt;
        }
        // Another tab explicitly took over our exact session fingerprint.
        // Only yield if the incoming claim is newer (or wins the deterministic tie-breaker
        // when two claims happen in the same millisecond) so older in-flight claims cannot
        // clobber a newer takeover.
        if (this.ownedFingerprint === msg.fingerprint) {
          const incomingWins =
            incomingClaimedAt > this.ownedClaimedAt ||
            (incomingClaimedAt === this.ownedClaimedAt && msg.tabId > this.tabId);
          if (incomingWins) {
            this.ownedFingerprint = null;
            this.ownedClaimedAt = 0;
            this.onSupersededCb?.({
              fingerprint: msg.fingerprint,
              newOwnerTabId: msg.tabId,
            });
          }
        } else if (this.activeProbe && this.activeProbe.fingerprint === msg.fingerprint) {
          this.finishActiveProbe({ activeElsewhere: true, ownerTabId: msg.tabId });
        }
        break;
      }

      case 'session_release': {
        // Closing another tab never revokes our session — purely informational.
        break;
      }
    }
  }

  private finishActiveProbe(result: ProbeResult): void {
    if (!this.activeProbe) return;
    const probe = this.activeProbe;
    this.activeProbe = null;
    clearTimeout(probe.timer);
    probe.resolve(result);
  }

  /**
   * Probes whether another live browser tab currently owns the exact same session fingerprint.
   * Resolves quickly if another tab responds, or after `timeoutMs` if no active owner replies.
   */
  public probeSession(fingerprint: string, timeoutMs = 180): Promise<ProbeResult> {
    if (this.disposed) {
      return Promise.resolve({ activeElsewhere: false });
    }
    if (this.activeProbe) {
      this.finishActiveProbe({ activeElsewhere: false });
    }

    return new Promise<ProbeResult>((resolve) => {
      const probeId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const timer = setTimeout(() => {
        this.finishActiveProbe({ activeElsewhere: false });
      }, timeoutMs);

      this.activeProbe = { probeId, fingerprint, resolve, timer };
      this.transport.postMessage({
        kind: 'session_probe',
        tabId: this.tabId,
        fingerprint,
        probeId,
      });
    });
  }

  /**
   * Marks this tab as the active owner of `fingerprint` and notifies any other tab holding
   * the same fingerprint to step aside cleanly.
   */
  public claimOwnership(fingerprint: string): void {
    if (this.disposed) return;
    const claimedAt = Math.max(Date.now(), this.ownedClaimedAt + 1, this.maxObservedClaimAt + 1);
    this.ownedFingerprint = fingerprint;
    this.ownedClaimedAt = claimedAt;
    this.maxObservedClaimAt = claimedAt;
    this.transport.postMessage({
      kind: 'session_claim',
      tabId: this.tabId,
      fingerprint,
      claimedAt,
    });
  }

  /**
   * Releases ONLY this tab's local claim (e.g., on unload, leave, or choosing to keep
   * the session active in another tab). Never invalidates another tab's session.
   */
  public releaseOwnership(): void {
    if (!this.ownedFingerprint) return;
    const fp = this.ownedFingerprint;
    this.ownedFingerprint = null;
    this.ownedClaimedAt = 0;
    if (!this.disposed) {
      this.transport.postMessage({
        kind: 'session_release',
        tabId: this.tabId,
        fingerprint: fp,
      });
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.finishActiveProbe({ activeElsewhere: false });
    this.releaseOwnership();
    this.disposed = true;
    this.unsubscribe();
    this.transport.close();
  }
}
