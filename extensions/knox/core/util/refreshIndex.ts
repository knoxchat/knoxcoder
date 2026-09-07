import { Database } from "sqlite";
import sqlite3 from "sqlite3";

export type DatabaseConnection = Database<sqlite3.Database, sqlite3.Statement>;

export function truncateSqliteLikePattern(pattern: string): string {
  // Remove wildcard characters to prevent SQL injection
  return pattern.replace(/[%_]/g, '');
}
