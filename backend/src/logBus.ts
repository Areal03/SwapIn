import { EventEmitter } from "node:events";

export type LogEntry = {
  ts: number;
  level: "info" | "warn" | "error";
  message: string;
  orderId?: string;
  meta?: Record<string, unknown>;
};

type LogListener = (entry: LogEntry) => void;

export class LogBus {
  private emitter = new EventEmitter();
  private buffer: LogEntry[] = [];
  private readonly bufferSize: number;

  constructor(bufferSize = 400) {
    this.bufferSize = bufferSize;
  }

  listRecent(orderId?: string): LogEntry[] {
    if (!orderId) return [...this.buffer];
    return this.buffer.filter((l) => l.orderId === orderId);
  }

  onLog(listener: LogListener) {
    this.emitter.on("log", listener);
    return () => this.emitter.off("log", listener);
  }

  log(entry: LogEntry) {
    this.buffer.push(entry);
    if (this.buffer.length > this.bufferSize) this.buffer.splice(0, this.buffer.length - this.bufferSize);
    this.emitter.emit("log", entry);
  }

  info(message: string, orderId?: string, meta?: Record<string, unknown>) {
    this.log({ ts: Date.now(), level: "info", message, orderId, meta });
  }

  warn(message: string, orderId?: string, meta?: Record<string, unknown>) {
    this.log({ ts: Date.now(), level: "warn", message, orderId, meta });
  }

  error(message: string, orderId?: string, meta?: Record<string, unknown>) {
    this.log({ ts: Date.now(), level: "error", message, orderId, meta });
  }
}

export const logBus = new LogBus();

