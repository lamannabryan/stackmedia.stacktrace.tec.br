export class HttpError extends Error {
  constructor(statusCode, message, { expose = statusCode < 500 } = {}) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.expose = expose;
  }
}

export function badRequest(message) {
  return new HttpError(400, message);
}
