export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: "ADMIN" | "OWNER" | "TENANT";
}

interface AuthResponse {
  user: AuthUser;
}

interface ErrorResponse {
  error?: {
    message?: string;
    issues?: Array<{ path: Array<string | number>; message: string }>;
  };
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "/api/v1").replace(/\/$/, "");

export class AuthApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "AuthApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.method === "POST" && path.endsWith("/logout")) {
    const csrfToken = readCookie("pg_csrf");
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as ErrorResponse;
    const issues = payload.error?.issues?.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" · ");
    throw new AuthApiError(issues || payload.error?.message || "The request could not be completed.", response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function readCookie(name: string): string | null {
  const cookie = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : null;
}

export const authApi = {
  async currentUser(): Promise<AuthUser> {
    const response = await request<AuthResponse>("/auth/me");
    return response.user;
  },
  async register(input: { fullName: string; email: string; password: string }): Promise<AuthUser> {
    const response = await request<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return response.user;
  },
  async login(input: { email: string; password: string }): Promise<AuthUser> {
    const response = await request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return response.user;
  },
  logout(): Promise<void> {
    return request<void>("/auth/logout", { method: "POST" });
  },
};
