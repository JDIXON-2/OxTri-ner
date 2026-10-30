import type { WorkoutStep } from '../workout/csv';
import type { OxDb, WorkoutRow } from './db';

export async function addWorkout(db: OxDb, name: string, steps: WorkoutStep[]): Promise<number> {
  return db.workouts.add({ name, steps, createdAt: Date.now() });
}

export function listWorkouts(db: OxDb): Promise<WorkoutRow[]> {
  return db.workouts.orderBy('createdAt').reverse().toArray();
}

export function getWorkout(db: OxDb, id: number): Promise<WorkoutRow | undefined> {
  return db.workouts.get(id);
}

export async function deleteWorkout(db: OxDb, id: number): Promise<void> {
  await db.workouts.delete(id);
}
