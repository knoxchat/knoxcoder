export class JevClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JevClientError";
  }
}
