/**
 * Web API client. The session token comes from the meta tag the server
 * injected into the served index page; mutations always carry it as the
 * X-Arclume-Session header.
 */

export function sessionToken(): string {
  return document.querySelector('meta[name="arclume-session"]')?.getAttribute("content") ?? "";
}

export interface ApiErrorPayload {
  ok: false;
  code: string;
  message: string;
  hint?: string;
}

export class WebApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "WebApiError";
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-arclume-session": sessionToken(),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }
  if (!res.ok) {
    const err = parsed as Partial<ApiErrorPayload> | undefined;
    throw new WebApiError(
      res.status,
      err?.code ?? `http/${res.status}`,
      err?.message ?? `HTTP ${res.status}`,
      err?.hint,
    );
  }
  return parsed as T;
}

export function downloadUrl(workspaceId: string, fileId: string): string {
  return `/files/${workspaceId}/${fileId}?session=${sessionToken()}`;
}

export function previewUrl(workspaceId: string): string {
  return `/preview/${workspaceId}?session=${sessionToken()}`;
}
