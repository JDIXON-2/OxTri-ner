import type { RouteData } from '../route/gpx';
import type { OxDb, RouteRow } from './db';

export async function addRoute(db: OxDb, route: RouteData): Promise<number> {
  return db.routes.add({ ...route, createdAt: Date.now() });
}

export function listRoutes(db: OxDb): Promise<RouteRow[]> {
  return db.routes.orderBy('createdAt').reverse().toArray();
}

export function getRoute(db: OxDb, id: number): Promise<RouteRow | undefined> {
  return db.routes.get(id);
}

export async function renameRoute(db: OxDb, id: number, name: string): Promise<void> {
  await db.routes.update(id, { name });
}

export async function deleteRoute(db: OxDb, id: number): Promise<void> {
  await db.routes.delete(id);
}
