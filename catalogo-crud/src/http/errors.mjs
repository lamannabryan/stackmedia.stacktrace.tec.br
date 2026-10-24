export class HttpError extends Error {
  constructor(statusCode, message, { expose = statusCode < 500, code } = {}) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.expose = expose;
    this.code = code;
  }
}

export function badRequest(message) {
  return new HttpError(400, message);
}
