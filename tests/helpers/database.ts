/// <reference types="node" />
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import type { Database, SqlStatement } from '../../src/engine/store';

// A small D1 adapter uses real SQLite SQL and atomic conditional updates, with no external service.
export class MemoryDatabase implements Database {
  readonly sqlite = new DatabaseSync(':memory:');
  constructor() {
    const directory = new NodeURL('../../migrations/', import.meta.url);
    for (const file of readdirSync(directory)
      .filter((name) => name.endsWith('.sql'))
      .sort())
      this.sqlite.exec(readFileSync(new NodeURL(file, directory), 'utf8'));
  }
  close() {
    this.sqlite.close();
  }
  prepare(sql: string): SqlStatement {
    const statement = this.sqlite.prepare(sql);
    let values: SQLInputValue[] = [];
    const wrapper: SqlStatement = {
      bind(...args: unknown[]) {
        values = args as SQLInputValue[];
        return wrapper;
      },
      async first<T>() {
        return (statement.get(...values) as T | undefined) ?? null;
      },
      async all<T>() {
        return { results: statement.all(...values) as T[] };
      },
      async run() {
        const result = statement.run(...values);
        return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      },
    };
    return wrapper;
  }
}
