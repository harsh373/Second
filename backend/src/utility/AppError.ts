export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code: string = "APP_ERROR",
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}