export type ScheduleCategory = "work" | "other";

export interface ScheduleEvent {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  title: string;
  time?: string;
  note?: string;
  category?: ScheduleCategory;
  createdAt: number;
}

export interface ScheduleSnapshot {
  updatedAt: number;
  events: ScheduleEvent[];
}

/** One-time pairing to Mac (stored locally). Not an always-on link. */
export interface Pairing {
  host: string;
  port: number;
  token: string;
  /** Last successful sync time */
  lastSyncAt?: number;
}

export interface PhoneEvent {
  kind: string;
  text: string;
  emoji?: string;
  category?: string;
  title?: string;
  at?: number;
}
