type OnLine = (line: string) => void;

export class JsonlDecoder {
  private buffer = "";

  push(chunk: string, onLine: OnLine): void {
    this.buffer += chunk;
    while (true) {
      const idx = this.buffer.indexOf("\n");
      if (idx === -1) {
        break;
      }
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (line) {
        onLine(line);
      }
    }
  }
}

