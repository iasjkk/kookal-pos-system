
import axios, {
  AxiosAdapter,
  AxiosError,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";

const API_TIMEOUT = 30000;

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

type AppsScriptResult = {
  status?: number;
  body?: unknown;
};

type BridgeResponse = {
  type: "KOOKAL_BRIDGE_RESPONSE";
  id: string;
  status?: number;
  body?: unknown;
};

type PendingRequest = {
  resolve: (result: AppsScriptResult) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

let bridgeFrame: HTMLIFrameElement | null = null;
let bridgeReady: Promise<void> | null = null;

const pendingRequests = new Map<string, PendingRequest>();

let requestCounter = 0;

function getBridgeUrl(): string {
  if (!API_BASE_URL) {
    throw new Error("VITE_API_BASE_URL is not configured.");
  }

  const url = new URL(API_BASE_URL);

  url.searchParams.set("bridge", "1");

  return url.toString();
}

function initializeBridge(): Promise<void> {
  if (bridgeReady) {
    return bridgeReady;
  }

  const readyPromise = new Promise<void>((resolve, reject) => {
    const iframe = document.createElement("iframe");

    iframe.src = getBridgeUrl();
    iframe.title = "KOOKAL Apps Script Bridge";
    iframe.style.display = "none";
    iframe.setAttribute("aria-hidden", "true");

    const timeout = setTimeout(() => {
      iframe.remove();
      bridgeReady = null;

      reject(
        new Error("Unable to load KOOKAL Apps Script bridge.")
      );
    }, API_TIMEOUT);

    iframe.onload = () => {
      clearTimeout(timeout);

      bridgeFrame = iframe;
      resolve();
    };

    iframe.onerror = () => {
      clearTimeout(timeout);

      iframe.remove();
      bridgeFrame = null;
      bridgeReady = null;

      reject(
        new Error("Failed to load KOOKAL Apps Script bridge.")
      );
    };

    document.body.appendChild(iframe);
  });

  bridgeReady = readyPromise;

  return readyPromise;
}

// Receive responses from the Apps Script iframe
window.addEventListener("message", (event: MessageEvent) => {
  // Validate the actual iframe window, not its redirected origin
  if (!bridgeFrame || event.source !== bridgeFrame.contentWindow) {
    return;
  }

  const response = event.data as BridgeResponse;

  if (
    !response ||
    response.type !== "KOOKAL_BRIDGE_RESPONSE" ||
    typeof response.id !== "string"
  ) {
    return;
  }

  const pending = pendingRequests.get(response.id);

  if (!pending) {
    return;
  }

  clearTimeout(pending.timeout);
  pendingRequests.delete(response.id);

  pending.resolve({
    status: response.status,
    body: response.body,
  });
});

function getRequestPayload(
  config: InternalAxiosRequestConfig
): Record<string, unknown> {
  let payload: Record<string, unknown> = {};

  if (config.data !== undefined && config.data !== null) {
    try {
      payload =
        typeof config.data === "string"
          ? JSON.parse(config.data)
          : config.data;
    } catch {
      throw new Error("Invalid JSON request body.");
    }
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new Error("Invalid API request payload.");
  }

  const authorization =
    config.headers?.get?.("Authorization") ||
    config.headers?.Authorization ||
    config.headers?.authorization;

  const token =
    typeof authorization === "string"
      ? authorization.replace(/^Bearer\s+/i, "")
      : localStorage.getItem("kookal_token");

  const result: Record<string, unknown> = { ...payload };

  if (token) {
    result.token = token;
  }

  if (config.params) {
    Object.entries(config.params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        result[key] = value;
      }
    });
  }

  return result;
}

async function sendAppsScriptRequest(
  config: InternalAxiosRequestConfig
): Promise<AxiosResponse> {
  const method = (config.method || "GET").toUpperCase();

  if (!["GET", "POST", "PATCH"].includes(method)) {
    throw new AxiosError(
      `Unsupported API method: ${method}`,
      AxiosError.ERR_BAD_REQUEST,
      config
    );
  }

  let payload: Record<string, unknown>;

  try {
    payload = getRequestPayload(config);
  } catch (error: unknown) {
    throw new AxiosError(
      error instanceof Error
        ? error.message
        : "Invalid API request payload.",
      AxiosError.ERR_BAD_REQUEST,
      config
    );
  }

  let result: AppsScriptResult;

  try {
    await initializeBridge();

    if (!bridgeFrame?.contentWindow) {
      throw new Error("KOOKAL Apps Script bridge is unavailable.");
    }

    const id = `kookal-${Date.now()}-${++requestCounter}`;

    result = await new Promise<AppsScriptResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequests.delete(id);

        reject(
          new Error("KOOKAL API request timed out. Please try again.")
        );
      }, API_TIMEOUT);

      pendingRequests.set(id, {
        resolve,
        reject,
        timeout,
      });

      bridgeFrame!.contentWindow!.postMessage(
        {
          type: "KOOKAL_BRIDGE_REQUEST",
          id,
          method,
          path: config.url || "/",
          payload,
        },
        "*"
      );
    });
  } catch (error: unknown) {
    throw new AxiosError(
      error instanceof Error
        ? error.message
        : "Unable to communicate with KOOKAL backend.",
      AxiosError.ERR_NETWORK,
      config
    );
  }

  const status = Number(result?.status || 200);

  const response: AxiosResponse = {
    data: result?.body,
    status,
    statusText: "",
    headers: {},
    config,
  };

  if (status < 200 || status >= 300) {
    const message =
      (result?.body as { error?: string })?.error ||
      "KOOKAL API request failed.";

    throw new AxiosError(
      message,
      status === 401
        ? AxiosError.ERR_BAD_REQUEST
        : AxiosError.ERR_BAD_RESPONSE,
      config,
      undefined,
      response
    );
  }

  return response;
}

const appsScriptAdapter: AxiosAdapter = async (config) => {
  return sendAppsScriptRequest(config);
};

// Axios instance
export const api = axios.create(
  import.meta.env.PROD
    ? {
        adapter: appsScriptAdapter,
        timeout: API_TIMEOUT,
      }
    : {
        baseURL: "/api",
        timeout: API_TIMEOUT,
      }
);

// Authentication token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("kookal_token");

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

// Handle expired authentication
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

// Currency formatter
export const money = (v: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(v || 0));

// Indian date formatter
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
