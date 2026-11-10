
import axios, {
  AxiosAdapter,
  AxiosError,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";

const BRIDGE_TIMEOUT = 30000;

type BridgeMessage = {
  type: string;
  id?: string;
  method?: string;
  path?: string;
  payload?: Record<string, unknown>;
  status?: number;
  body?: unknown;
};

type PendingRequest = {
  resolve: (response: AxiosResponse) => void;
  reject: (error: unknown) => void;
  config: InternalAxiosRequestConfig;
  timeout: ReturnType<typeof setTimeout>;
};

const pendingRequests = new Map<string, PendingRequest>();

function handleBridgeMessage(event: MessageEvent): void {
  if (event.source !== window.parent) return;

  const message = event.data as BridgeMessage;

  if (!message || typeof message !== "object") return;
  if (message.type !== "KOOKAL_BRIDGE_RESPONSE" || !message.id) return;

  const pending = pendingRequests.get(message.id);

  if (!pending) return;

  clearTimeout(pending.timeout);
  pendingRequests.delete(message.id);

  const response: AxiosResponse = {
    data: message.body,
    status: Number(message.status || 200),
    statusText: "",
    headers: {},
    config: pending.config,
  };

  if (response.status >= 200 && response.status < 300) {
    pending.resolve(response);
  } else {
    pending.reject(
      new AxiosError(
        (message.body as { error?: string })?.error ||
          "KOOKAL API request failed.",
        response.status === 401
          ? AxiosError.ERR_BAD_REQUEST
          : AxiosError.ERR_BAD_RESPONSE,
        pending.config,
        undefined,
        response
      )
    );
  }
}

window.addEventListener("message", handleBridgeMessage);

function getRequestPayload(
  config: InternalAxiosRequestConfig
): Record<string, unknown> {
  let payload: Record<string, unknown> = {};

  if (config.data) {
    try {
      payload =
        typeof config.data === "string"
          ? JSON.parse(config.data)
          : config.data;
    } catch {
      throw new Error("Invalid JSON request body.");
    }
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid API request payload.");
  }

  const headers = config.headers;

  const authorization =
    headers?.get?.("Authorization") ||
    headers?.Authorization ||
    headers?.authorization;

  const token =
    typeof authorization === "string"
      ? authorization.replace(/^Bearer\s+/i, "")
      : localStorage.getItem("kookal_token");

  return {
    ...payload,
    ...(token ? { token } : {}),
  };
}

function sendBridgeRequest(
  config: InternalAxiosRequestConfig
): Promise<AxiosResponse> {
  return new Promise((resolve, reject) => {
    const requestId =
      "kookal_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2);

    let requestUrl: URL;

    try {
      requestUrl = new URL(config.url || "/", window.location.origin);
    } catch {
      reject(new Error("Invalid API request URL."));
      return;
    }

    const path = requestUrl.pathname;
    const params = new URLSearchParams();

    if (config.params) {
      Object.entries(config.params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.set(key, String(value));
        }
      });
    }

    requestUrl.searchParams.forEach((value, key) => {
      params.set(key, value);
    });

    const payload = getRequestPayload(config);

    params.forEach((value, key) => {
      payload[key] = value;
    });

    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);

      reject(
        new AxiosError(
          "KOOKAL API request timed out.",
          AxiosError.ETIMEDOUT,
          config
        )
      );
    }, BRIDGE_TIMEOUT);

    pendingRequests.set(requestId, {
      resolve,
      reject,
      config,
      timeout,
    });

    window.parent.postMessage(
      {
        type: "KOOKAL_BRIDGE_REQUEST",
        id: requestId,
        method: (config.method || "GET").toUpperCase(),
        path,
        payload,
      },
      "*"
    );
  });
}

const bridgeAdapter: AxiosAdapter = async (config) => {
  return sendBridgeRequest(config);
};

export const api = axios.create(
  import.meta.env.PROD
    ? {
        adapter: bridgeAdapter,
        timeout: BRIDGE_TIMEOUT,
      }
    : {
        baseURL: "/api",
        timeout: BRIDGE_TIMEOUT,
      }
);

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("kookal_token");

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("kookal_token");
      localStorage.removeItem("kookal_user");
    }

    return Promise.reject(error);
  }
);

export const money = (v: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(v || 0));

export const today = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
};
