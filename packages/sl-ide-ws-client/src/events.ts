/**
 * @file events.ts
 * disposable and event implementations to match their
 * VS Code counterparts for easy integration
 */

export interface Disposable {
    dispose(): void;
}

export type Event<T> = (
    listener: (e: T) => any,
    thisArgs?: any,
    disposables?: Disposable[],
) => Disposable;

export class Emitter<T> implements Disposable {
    private listeners: { callback: (e: T) => any; thisArgs?: any }[] = [];

    public readonly event: Event<T> = (listener, thisArgs, disposables) => {
        const entry = { callback: listener, thisArgs };
        this.listeners.push(entry);

        const subscription: Disposable = {
            dispose: () => {
                const index = this.listeners.indexOf(entry);
                if (index !== -1) {
                    this.listeners.splice(index, 1);
                }
            },
        };

        disposables?.push(subscription);
        return subscription;
    };

    public fire(data: T): void {
        // Copy first so listeners added or removed during dispatch don't affect this round.
        for (const { callback, thisArgs } of [...this.listeners]) {
            try {
                callback.call(thisArgs, data);
            } catch (error) {
                console.error("Error in event listener:", error);
            }
        }
    }

    public dispose(): void {
        this.listeners = [];
    }
}

/** Logging sink supplied by the host, so the package never depends on an output channel. */
export interface WsLogger {
    debug?(message: string): void;
    info?(message: string): void;
    warn?(message: string): void;
    error?(message: string, error?: unknown): void;
}

/**
 * How prominently a user-visible message should be surfaced.
 * "info" expects a notification, "status" a transient status line.
 */
export type NotifyKind = "info" | "status";

/** User-visible messaging hook supplied by the host. */
export type NotifyHost = (message: string, kind: NotifyKind) => void;
