export class DebouncedSaver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private dirty = false;

  constructor(
    private readonly delayMs: number,
    private readonly save: () => Promise<void>,
  ) {}

  schedule(): void {
    this.dirty = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().catch(() => undefined);
    }, this.delayMs);
  }

  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.dirty = false;
  }

  flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return this.chain;
    this.dirty = false;
    const task = this.chain.then(() => this.save());
    this.chain = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  get pending(): boolean {
    return this.dirty;
  }
}
