import { SPEED_LEVELS } from '../sim/simulation';

/**
 * Pause / speed state behind the ‹ ⏸ › controls. The simulation's speed is
 * always derived from this (0 while paused), so the controls change real timing.
 */
export class TimeControl {
  /** Index into SPEED_LEVELS of the running speed (remembered while paused). */
  level = 0;
  paused = false;

  /** Simulation speed to use: 0 when paused, otherwise the level's multiplier. */
  get speed(): number {
    return this.paused ? 0 : SPEED_LEVELS[this.level];
  }

  get multiplier(): number {
    return SPEED_LEVELS[this.level];
  }

  get canSlower(): boolean {
    return this.level > 0;
  }

  get canFaster(): boolean {
    return this.paused || this.level < SPEED_LEVELS.length - 1;
  }

  /** Sets an exact speed; 0 pauses, other values snap to the nearest level. */
  set(speed: number): void {
    if (speed <= 0) {
      this.paused = true;
      return;
    }
    this.paused = false;
    let best = 0;
    SPEED_LEVELS.forEach((v, k) => {
      if (Math.abs(v - speed) < Math.abs(SPEED_LEVELS[best] - speed)) best = k;
    });
    this.level = best;
  }

  togglePause(): void {
    this.paused = !this.paused;
  }

  /** One level up; resumes first if paused. Returns false at the limit. */
  faster(): boolean {
    if (!this.canFaster) return false;
    if (this.paused) this.paused = false;
    else this.level++;
    return true;
  }

  /** One level down (stays paused if paused). Returns false at the limit. */
  slower(): boolean {
    if (!this.canSlower) return false;
    this.level--;
    return true;
  }
}
