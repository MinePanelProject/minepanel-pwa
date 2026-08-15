import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { validatePanelOrigin } from './origin-validation';

export type PanelInstance = {
  id: string;
  origin: string;
  label?: string;
  createdAt: string;
  lastUsedAt: string;
};

type NewPanelInstance = {
  origin: string;
  label?: string;
};

type SafeInstanceUpdate = {
  label?: string;
  lastUsedAt?: string;
};

interface MinePanelDatabase extends DBSchema {
  instances: {
    key: string;
    value: PanelInstance;
    indexes: { origin: string };
  };
}

const DATABASE_NAME = 'minepanel-pwa';
const DATABASE_VERSION = 1;

export class InstanceRegistry {
  private databasePromise: Promise<IDBPDatabase<MinePanelDatabase>>;

  constructor() {
    this.databasePromise = openDB<MinePanelDatabase>(DATABASE_NAME, DATABASE_VERSION, {
      upgrade(database) {
        const store = database.createObjectStore('instances', { keyPath: 'id' });
        store.createIndex('origin', 'origin', { unique: true });
      },
    });
  }

  async list(): Promise<PanelInstance[]> {
    const database = await this.databasePromise;
    const instances = await database.getAll('instances');

    return [...instances].sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt));
  }

  async get(id: string): Promise<PanelInstance | undefined> {
    const database = await this.databasePromise;
    return database.get('instances', id);
  }

  async add(input: NewPanelInstance): Promise<PanelInstance> {
    const database = await this.databasePromise;
    const origin = validatePanelOrigin(input.origin);
    const existing = await database.getFromIndex('instances', 'origin', origin);

    if (existing) {
      throw new Error('This panel is already saved.');
    }

    const now = new Date().toISOString();
    const label = input.label?.trim();
    const instance: PanelInstance = {
      id: crypto.randomUUID(),
      origin,
      ...(label ? { label } : {}),
      createdAt: now,
      lastUsedAt: now,
    };

    await database.add('instances', instance);
    return instance;
  }

  async update(id: string, update: SafeInstanceUpdate): Promise<PanelInstance> {
    const database = await this.databasePromise;
    const current = await database.get('instances', id);

    if (!current) {
      throw new Error('The selected panel no longer exists.');
    }

    const label = update.label?.trim();
    const next: PanelInstance = {
      ...current,
      ...(label ? { label } : {}),
      ...(update.label === '' ? { label: undefined } : {}),
      ...(update.lastUsedAt ? { lastUsedAt: update.lastUsedAt } : {}),
    };

    await database.put('instances', next);
    return next;
  }

  async markUsed(id: string): Promise<PanelInstance> {
    return this.update(id, { lastUsedAt: new Date().toISOString() });
  }

  async remove(id: string): Promise<void> {
    const database = await this.databasePromise;
    await database.delete('instances', id);
  }
}
