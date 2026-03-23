import { ProxyAgent, fetch as undiciFetch } from "undici";
import { bindAbortRelay } from "../utils/fetch-timeout.js";

type FetchWithPreconnect = typeof fetch & {
  preconnect: (url: string, init?: { credentials?: RequestCredentials }) => void;
};

type RequestInitWithDuplex = RequestInit & { duplex?: "half" };

const wrapFetchWithAbortSignalMarker = Symbol.for("openclaw.fetch.abort-signal-wrapped");

type FetchWithAbortSignalMarker = typeof fetch & {
  [wrapFetchWithAbortSignalMarker]?: true;
};

let proxyFetchInstalled = false;

function withDuplex(
  init: RequestInit | undefined,
  input: RequestInfo | URL,
): RequestInit | undefined {
  const hasInitBody = init?.body != null;
  const hasRequestBody =
    !hasInitBody &&
    typeof Request !== "undefined" &&
    input instanceof Request &&
    input.body != null;
  if (!hasInitBody && !hasRequestBody) {
    return init;
  }
  if (init && "duplex" in (init as Record<string, unknown>)) {
    return init;
  }
  return init
    ? ({ ...init, duplex: "half" as const } as RequestInitWithDuplex)
    : ({ duplex: "half" as const } as RequestInitWithDuplex);
}

export function wrapFetchWithAbortSignal(fetchImpl: typeof fetch): typeof fetch {
  if ((fetchImpl as FetchWithAbortSignalMarker)[wrapFetchWithAbortSignalMarker]) {
    return fetchImpl;
  }

  const wrapped = ((input: RequestInfo | URL, init?: RequestInit) => {
    const patchedInit = withDuplex(init, input);
    const signal = patchedInit?.signal;
    if (!signal) {
      return fetchImpl(input, patchedInit);
    }
    if (typeof AbortSignal !== "undefined" && signal instanceof AbortSignal) {
      return fetchImpl(input, patchedInit);
    }
    if (typeof AbortController === "undefined") {
      return fetchImpl(input, patchedInit);
    }
    if (typeof signal.addEventListener !== "function") {
      return fetchImpl(input, patchedInit);
    }
    const controller = new AbortController();
    const onAbort = bindAbortRelay(controller);
    let listenerAttached = false;
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
      listenerAttached = true;
    }
    const cleanup = () => {
      if (!listenerAttached || typeof signal.removeEventListener !== "function") {
        return;
      }
      listenerAttached = false;
      try {
        signal.removeEventListener("abort", onAbort);
      } catch {
        // Foreign/custom AbortSignal implementations may throw here.
        // Never let cleanup mask the original fetch result/error.
      }
    };
    try {
      const response = fetchImpl(input, { ...patchedInit, signal: controller.signal });
      return response.finally(cleanup);
    } catch (error) {
      cleanup();
      throw error;
    }
  }) as FetchWithPreconnect;

  const wrappedFetch = Object.assign(wrapped, fetchImpl) as FetchWithPreconnect;
  const fetchWithPreconnect = fetchImpl as FetchWithPreconnect;
  wrappedFetch.preconnect =
    typeof fetchWithPreconnect.preconnect === "function"
      ? fetchWithPreconnect.preconnect.bind(fetchWithPreconnect)
      : () => {};

  Object.defineProperty(wrappedFetch, wrapFetchWithAbortSignalMarker, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  return wrappedFetch;
}

export function resolveFetch(fetchImpl?: typeof fetch): typeof fetch | undefined {
  const resolved = fetchImpl ?? globalThis.fetch;
  if (!resolved) {
    return undefined;
  }
  return wrapFetchWithAbortSignal(resolved);
}

function resolveProxyUrl(env: NodeJS.ProcessEnv): string | null {
  const raw =
    env.OPENCLAW_PROXY_URL?.trim() ||
    env.https_proxy?.trim() ||
    env.HTTPS_PROXY?.trim() ||
    env.http_proxy?.trim() ||
    env.HTTP_PROXY?.trim() ||
    env.all_proxy?.trim() ||
    env.ALL_PROXY?.trim();
  if (!raw) {
    return null;
  }
  return raw.includes("://") ? raw : `http://${raw}`;
}

function resolveFetchUrl(input: RequestInfo | URL): URL | null {
  if (typeof input === "string") {
    try {
      return new URL(input);
    } catch {
      return null;
    }
  }
  if (input instanceof URL) {
    return input;
  }
  if (typeof Request !== "undefined" && input instanceof Request) {
    try {
      return new URL(input.url);
    } catch {
      return null;
    }
  }
  return null;
}

function parseNoProxyList(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function shouldBypassProxy(url: URL, env: NodeJS.ProcessEnv): boolean {
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return true;
  }

  const noProxy = parseNoProxyList(env.NO_PROXY ?? env.no_proxy);
  if (noProxy.length === 0) {
    return false;
  }

  for (const entryRaw of noProxy) {
    const entry = entryRaw.toLowerCase();
    if (entry === "*") {
      return true;
    }
    const normalized = entry.replace(/:\\d+$/, "");
    if (!normalized) {
      continue;
    }
    if (normalized.startsWith(".")) {
      if (hostname.endsWith(normalized)) {
        return true;
      }
      continue;
    }
    if (hostname === normalized || hostname.endsWith(`.${normalized}`)) {
      return true;
    }
  }

  return false;
}

export function installProxyFetchFromEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (proxyFetchInstalled) {
    return;
  }
  const proxyUrl = resolveProxyUrl(env);
  if (!proxyUrl) {
    return;
  }

  const dispatcher = new ProxyAgent(proxyUrl);
  const nativeFetch = globalThis.fetch;
  const proxyFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    undiciFetch(input as string | URL, {
      ...((init as Record<string, unknown> | undefined) ?? {}),
      dispatcher,
    }) as unknown as Promise<Response>) as typeof fetch;

  const combined = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = resolveFetchUrl(input);
    if (url && url.protocol !== "http:" && url.protocol !== "https:") {
      return nativeFetch ? nativeFetch(input, init) : proxyFetch(input, init);
    }
    if (url && shouldBypassProxy(url, env) && nativeFetch) {
      return nativeFetch(input, init);
    }
    return proxyFetch(input, init);
  }) as FetchWithPreconnect;

  combined.preconnect = (url, init) => {
    const resolved = resolveFetchUrl(url);
    if (resolved && shouldBypassProxy(resolved, env) && nativeFetch) {
      const nativeWithPreconnect = nativeFetch as FetchWithPreconnect;
      if (typeof nativeWithPreconnect.preconnect === "function") {
        nativeWithPreconnect.preconnect(url, init);
        return;
      }
    }
    const undiciWithPreconnect = undiciFetch as unknown as FetchWithPreconnect;
    if (typeof undiciWithPreconnect.preconnect === "function") {
      undiciWithPreconnect.preconnect(url, init);
    }
  };

  globalThis.fetch = wrapFetchWithAbortSignal(combined);
  proxyFetchInstalled = true;
}
