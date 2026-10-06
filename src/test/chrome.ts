/**
 * In-memory fake of the subset of the `chrome.*` extension APIs that Prowl uses.
 * Installed globally by `tests/unit/setup.ts` and reset before every test.
 * Extend it here (not in individual tests) when a new API is needed.
 */

type Listener<A extends unknown[]> = (...args: A) => unknown;

export class FakeEvent<A extends unknown[]> {
  private listeners = new Set<Listener<A>>();
  addListener(fn: Listener<A>): void {
    this.listeners.add(fn);
  }
  removeListener(fn: Listener<A>): void {
    this.listeners.delete(fn);
  }
  hasListener(fn: Listener<A>): boolean {
    return this.listeners.has(fn);
  }
  hasListeners(): boolean {
    return this.listeners.size > 0;
  }
  /** Test helper: invoke every listener and return their results. */
  emit(...args: A): unknown[] {
    return [...this.listeners].map((fn) => fn(...args));
  }
  clear(): void {
    this.listeners.clear();
  }
}

type StorageChanges = Record<string, chrome.storage.StorageChange>;

class FakeStorageArea {
  data = new Map<string, unknown>();
  readonly onChanged = new FakeEvent<[StorageChanges]>();
  constructor(
    private readonly areaName: string,
    private readonly global: FakeEvent<[StorageChanges, string]>,
  ) {}

  async get(
    keys?: string | string[] | Record<string, unknown> | null,
  ): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    if (keys === null || keys === undefined) {
      for (const [k, v] of this.data) out[k] = structuredClone(v);
      return out;
    }
    if (typeof keys === 'string') keys = [keys];
    if (Array.isArray(keys)) {
      for (const k of keys) if (this.data.has(k)) out[k] = structuredClone(this.data.get(k));
      return out;
    }
    for (const [k, fallback] of Object.entries(keys)) {
      out[k] = this.data.has(k) ? structuredClone(this.data.get(k)) : fallback;
    }
    return out;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    const changes: StorageChanges = {};
    for (const [k, v] of Object.entries(items)) {
      changes[k] = { oldValue: this.data.get(k), newValue: structuredClone(v) };
      this.data.set(k, structuredClone(v));
    }
    this.fire(changes);
  }

  async remove(keys: string | string[]): Promise<void> {
    const changes: StorageChanges = {};
    for (const k of typeof keys === 'string' ? [keys] : keys) {
      if (!this.data.has(k)) continue;
      changes[k] = { oldValue: this.data.get(k) };
      this.data.delete(k);
    }
    this.fire(changes);
  }

  async clear(): Promise<void> {
    await this.remove([...this.data.keys()]);
  }

  async getBytesInUse(): Promise<number> {
    return JSON.stringify(Object.fromEntries(this.data)).length;
  }

  async setAccessLevel(): Promise<void> {}

  private fire(changes: StorageChanges): void {
    if (Object.keys(changes).length === 0) return;
    this.onChanged.emit(changes);
    this.global.emit(changes, this.areaName);
  }
}

export interface FakeNotification {
  id: string;
  options: chrome.notifications.NotificationCreateOptions;
}

export function createFakeChrome() {
  const storageOnChanged = new FakeEvent<[StorageChanges, string]>();
  const alarms = new Map<string, chrome.alarms.Alarm>();
  const notifications = new Map<string, FakeNotification>();
  const badge = { text: '', color: '' as string | number[], title: 'Prowl' };
  const createdTabs: chrome.tabs.CreateProperties[] = [];
  const grantedOrigins = new Set<string>();
  let notificationSeq = 0;

  const fake = {
    runtime: {
      id: 'prowl-test-extension',
      lastError: undefined as chrome.runtime.LastError | undefined,
      getURL: (path: string) =>
        `chrome-extension://prowl-test-extension/${path.replace(/^\//, '')}`,
      getManifest: () => ({ manifest_version: 3, name: 'Prowl', version: '0.0.0-test' }),
      sendMessage: async (_message: unknown) => undefined as unknown,
      onMessage: new FakeEvent<
        [unknown, chrome.runtime.MessageSender, (response?: unknown) => void]
      >(),
      onInstalled: new FakeEvent<[chrome.runtime.InstalledDetails]>(),
      onStartup: new FakeEvent<[]>(),
      openOptionsPage: async () => undefined,
    },
    storage: {
      local: undefined as unknown as FakeStorageArea,
      sync: undefined as unknown as FakeStorageArea,
      session: undefined as unknown as FakeStorageArea,
      onChanged: storageOnChanged,
    },
    alarms: {
      create: async (name: string, info: chrome.alarms.AlarmCreateInfo) => {
        const period = info.periodInMinutes;
        const when = info.when ?? Date.now() + (info.delayInMinutes ?? period ?? 0) * 60_000;
        alarms.set(name, {
          name,
          scheduledTime: when,
          persistAcrossSessions: true,
          ...(period ? { periodInMinutes: period } : {}),
        });
      },
      get: async (name: string) => alarms.get(name),
      getAll: async () => [...alarms.values()],
      clear: async (name: string) => alarms.delete(name),
      clearAll: async () => {
        const had = alarms.size > 0;
        alarms.clear();
        return had;
      },
      onAlarm: new FakeEvent<[chrome.alarms.Alarm]>(),
    },
    notifications: {
      create: async (
        idOrOptions: string | chrome.notifications.NotificationCreateOptions,
        maybeOptions?: chrome.notifications.NotificationCreateOptions,
      ) => {
        const id =
          typeof idOrOptions === 'string' ? idOrOptions : `notification-${++notificationSeq}`;
        const options = (typeof idOrOptions === 'string' ? maybeOptions : idOrOptions) ?? {};
        notifications.set(id, {
          id,
          options: options as chrome.notifications.NotificationCreateOptions,
        });
        return id;
      },
      clear: async (id: string) => notifications.delete(id),
      getAll: async () => Object.fromEntries([...notifications.keys()].map((id) => [id, true])),
      onClicked: new FakeEvent<[string]>(),
      onButtonClicked: new FakeEvent<[string, number]>(),
      onClosed: new FakeEvent<[string, boolean]>(),
    },
    action: {
      setBadgeText: async ({ text }: { text?: string | null }) => {
        badge.text = text ?? '';
      },
      getBadgeText: async () => badge.text,
      setBadgeBackgroundColor: async ({ color }: { color: string | number[] }) => {
        badge.color = color;
      },
      setBadgeTextColor: async () => undefined,
      setTitle: async ({ title }: { title: string }) => {
        badge.title = title;
      },
    },
    sidePanel: {
      setPanelBehavior: async (_behavior: chrome.sidePanel.PanelBehavior) => undefined,
      open: async (_options: chrome.sidePanel.OpenOptions) => undefined,
      setOptions: async (_options: chrome.sidePanel.PanelOptions) => undefined,
    },
    tabs: {
      create: async (props: chrome.tabs.CreateProperties) => {
        createdTabs.push(props);
        return { id: createdTabs.length, ...props } as unknown as chrome.tabs.Tab;
      },
      query: async () => [] as chrome.tabs.Tab[],
    },
    permissions: {
      contains: async ({ origins = [] }: chrome.permissions.Permissions) =>
        origins.every((o) => grantedOrigins.has(o)),
      request: async ({ origins = [] }: chrome.permissions.Permissions) => {
        for (const o of origins) grantedOrigins.add(o);
        return true;
      },
      remove: async ({ origins = [] }: chrome.permissions.Permissions) => {
        for (const o of origins) grantedOrigins.delete(o);
        return true;
      },
    },
    /** Test-only inspection handles. Not part of the real API. */
    __state: { alarms, notifications, badge, createdTabs, grantedOrigins },
  };

  fake.storage.local = new FakeStorageArea('local', storageOnChanged);
  fake.storage.sync = new FakeStorageArea('sync', storageOnChanged);
  fake.storage.session = new FakeStorageArea('session', storageOnChanged);
  return fake;
}

export type FakeChrome = ReturnType<typeof createFakeChrome>;

/** Install a fresh fake on `globalThis.chrome` and return it. */
export function installFakeChrome(): FakeChrome {
  const fake = createFakeChrome();
  (globalThis as unknown as { chrome: FakeChrome }).chrome = fake;
  return fake;
}

/** The fake currently installed on `globalThis.chrome`. */
export function fakeChrome(): FakeChrome {
  return (globalThis as unknown as { chrome: FakeChrome }).chrome;
}
