import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import m1 from '../../migrations/0001_init.sql?raw';
import m2 from '../../migrations/0002_create_body.sql?raw';
import m3 from '../../migrations/0003_method.sql?raw';
import m4 from '../../migrations/0004_share.sql?raw';
import m5 from '../../migrations/0005_decision_context.sql?raw';
import type { Database, SqlStatement } from '../engine/store';

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

export function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    const isBrowser = typeof (globalThis as { window?: unknown }).window !== 'undefined';
    sqlJsPromise = initSqlJs(isBrowser ? { locateFile: () => sqlWasmUrl } : undefined);
  }
  return sqlJsPromise;
}

export class SqlJsDatabaseAdapter implements Database {
  constructor(readonly db: SqlJsDatabase) {}

  close(): void {
    this.db.close();
  }

  prepare(sql: string): SqlStatement {
    let values: unknown[] = [];
    const db = this.db;
    const wrapper: SqlStatement = {
      bind(...args: unknown[]) {
        values = args;
        return wrapper;
      },
      async first<T>() {
        const stmt = db.prepare(sql);
        try {
          stmt.bind(values.map((v) => (v === undefined ? null : v)) as any);
          if (stmt.step()) {
            return stmt.getAsObject() as T;
          }
          return null;
        } finally {
          stmt.free();
        }
      },
      async all<T>() {
        const stmt = db.prepare(sql);
        try {
          stmt.bind(values.map((v) => (v === undefined ? null : v)) as any);
          const results: T[] = [];
          while (stmt.step()) {
            results.push(stmt.getAsObject() as T);
          }
          return { results };
        } finally {
          stmt.free();
        }
      },
      async run() {
        const stmt = db.prepare(sql);
        try {
          stmt.bind(values.map((v) => (v === undefined ? null : v)) as any);
          stmt.step();
          const changes = db.getRowsModified();
          return { meta: { changes } };
        } finally {
          stmt.free();
        }
      },
    };
    return wrapper;
  }
}

export async function createProofDatabase(): Promise<SqlJsDatabaseAdapter> {
  const SQL = await getSqlJs();
  const db = new SQL.Database();
  db.run(m1);
  db.run(m2);
  db.run(m3);
  db.run(m4);
  db.run(m5);
  return new SqlJsDatabaseAdapter(db);
}
