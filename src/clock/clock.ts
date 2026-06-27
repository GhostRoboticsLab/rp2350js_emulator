export type AlarmCallback = () => void;

export interface IAlarm {
  schedule(deltaNanos: number): void;
  cancel(): void;
}

export interface IClock {
  readonly nanos: number;

  createAlarm(callback: AlarmCallback): IAlarm;

  /** Advance the clock by the given number of nanoseconds (RP2350 cycle stepping). */
  tick(deltaNanos: number): void;
}
