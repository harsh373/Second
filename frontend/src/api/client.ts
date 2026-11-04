import axios, { AxiosError, type AxiosRequestConfig } from "axios";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Every request goes to /api, which the Vite proxy forwards to the backend.
const http = axios.create({ baseURL: "/api" });

export async function apiFetch<T>(path: string, config?: AxiosRequestConfig): Promise<T> {
  try {
    const response = await http.request<T>({ url: path, ...config });
    return response.data;
  } catch (err) {
    if (err instanceof AxiosError) {
      // No response at all means the server is down or unreachable.
      if (!err.response) throw new ApiError(0, "Cannot reach the Second server.");
      const body = err.response.data as { error?: { message?: string; code?: string } } | undefined;
      throw new ApiError(err.response.status, body?.error?.message ?? err.message, body?.error?.code);
    }
    throw err;
  }
}