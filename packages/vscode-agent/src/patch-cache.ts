export class PatchCache {
  private readonly data = new Map<string, string>();

  set(commandId: string, diff: string): void {
    this.data.set(commandId, diff);
  }

  get(commandId: string): string | undefined {
    return this.data.get(commandId);
  }
}

