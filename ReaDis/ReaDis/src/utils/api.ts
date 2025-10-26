import { API_BASE } from '../config';

function joinUrl(base: string, path: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

export class HttpError extends Error {
  status: number;
  body?: any;
  constructor(status: number, message: string, body?: any) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request(method: string, path: string, body?: any, init: RequestInit = {}): Promise<any> {
  const url = joinUrl(API_BASE, path);
  const headers = new Headers(init.headers || {});
  if (body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const resp = await fetch(url, {
    ...init,
    method,
    headers,
    body: body !== undefined
      ? (headers.get('Content-Type')?.includes('application/json') ? JSON.stringify(body) : body)
      : undefined,
  });

  const text = await resp.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!resp.ok) {
    throw new HttpError(resp.status, typeof data === 'string' ? data : (data?.message || 'Request failed'), data);
  }
  return data;
}

export const api = {
  get: (path: string, init?: RequestInit) => request('GET', path, undefined, init),
  post: (path: string, data?: any, init?: RequestInit) => request('POST', path, data, init),
  put: (path: string, data?: any, init?: RequestInit) => request('PUT', path, data, init),
  delete: (path: string, init?: RequestInit) => request('DELETE', path, undefined, init),
};

export { API_BASE };
