
import axios, {
  AxiosAdapter,
  AxiosError,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";

const API_TIMEOUT = 30000;

const BRIDGE_URL = import.meta.env.VITE_APPS_SCRIPT_BRIDGE_URL;

type BridgeResponse = {
  type: "KOOKAL_BRIDGE_RESPONSE";
  id: string;
  status: number;
  body: unknown;
};

type PendingRequest = {
  resolve: (response: BridgeResponse) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

declare global {
  interface Window {
    __kookalBridgeFrame?: HTMLIFrameElement;
    __kookalBridgeReady?: Promise<HTMLIFrameElement>;
    __kookalBridgePending?: Map<string, PendingRequest>;
    __kookalBridgeListener?: boolean;
  }

  interface ImportMetaEnv {
    readonly VITE_APPS_SCRIPT_BRIDGE_URL?: string;
  }
}

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

function getBridgeUrl(): string {
  if (!BRIDGE_URL) {
    throw new Error(
      "Apps Script bridge URL is missing. " +
      "Configure VITE_APPS_SCRIPT_BRIDGE_URL in GitHub."
    );
  }

  const url = new URL(BRIDGE_URL);

  if (!url.searchParams.has("bridge")) {
    url.searchParams.set("bridge", "1");
  }

  return url.toString();
}

function createBridgeFrame(): Promise<HTMLIFrameElement> {
  if (window.__kookalBridgeReady) {
    return window.__kookalBridgeReady;
  }

  window.__kookalBridgeReady = new Promise(
    (resolve, reject) => {
      try {
        const frame = document.createElement("iframe");

        frame.src = getBridgeUrl();
        frame.title = "KOOKAL Apps Script Bridge";
        frame.style.display = "none";
        frame.setAttribute("aria-hidden", "true");

        const timeout = setTimeout(() => {
          reject(
            new Error(
              "KOOKAL bridge failed to load. Check the Apps Script URL."
            )
          );
        }, API_TIMEOUT);

        frame.onload = () => {
          clearTimeout(timeout);
          window.__kookalBridgeFrame = frame;
          resolve(frame);
        };

        frame.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("Unable to load KOOKAL Apps Script bridge."));
        };

        document.body.appendChild(frame);
      } catch (error) {
        reject(
          error instanceof Error
            ? error
            : new Error("Unable to initialize KOOKAL bridge.")
        );
      }
    }
  );

  return window.__kookalBridgeReady;
}

function initializeBridgeListener(): void {
  if (window.__kookalBridgeListener) return;

  window.__kookalBridgePending =
    window.__kookalBridgePending || new Map();

  window.addEventListener("message", (event: MessageEvent) => {
    const frame = window.__kookalBridgeFrame;

    // Accept messages only from our bridge iframe.
    if (!frame || event.source !== frame.contentWindow) {
      return;
    }

    const message = event.data as BridgeResponse;

    if (
      !message ||
      message.type !== "KOOKAL_BRIDGE_RESPONSE" ||
      typeof message.id !== "string"
    ) {
      return;
    }

    const pending = window.__kookalBridgePending?.get(message.id);

    if (!pending) return;

    clearTimeout(pending.timeout);
    window.__kookalBridgePending?.delete(message.id);

    pending.resolve(message);
  });

  window.__kookalBridgeListener = true;
}

function createRequestId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function sendBridgeRequest(
  method: string,
  path: string,
  payload: Record<string, unknown>
): Promise<BridgeResponse> {
  const frame = await createBridgeFrame();

  initializeBridgeListener();

  if (!frame.contentWindow) {
    throw new Error("KOOKAL bridge window is unavailable.");
  }

  const id = createRequestId();

  const response = await new Promise<BridgeResponse>(
    (resolve, reject) => {
      const timeout = setTimeout(() => {
        window.__kookalBridgePending?.delete(id);

        reject(
          new Error("KOOKAL API request timed out. Please try again.")
        );
      }, API_TIMEOUT);

      window.__kookalBridgePending?.set(id, {
        resolve,
        reject,
        timeout,
      });

      frame.contentWindow!.postMessage(
        {
          type: "KOOKAL_BRIDGE_REQUEST",
          id,
          method,
          path,
          payload,
        },
        "*"
      );
    }
  );

  return response;
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
  } catch (error) {
    throw new AxiosError(
      error instanceof Error
        ? error.message
        : "Invalid API request payload.",
      AxiosError.ERR_BAD_REQUEST,
      config
    );
  }

  const path = config.url || "/";

  console.log("[KOOKAL API] Bridge request:", method, path);

  let result: BridgeResponse;

  try {
    result = await sendBridgeRequest(method, path, payload);
  } catch (error) {
    console.error("[KOOKAL API] Bridge failure:", error);

    throw new AxiosError(
      error instanceof Error
        ? error.message
        : "Unable to communicate with KOOKAL backend.",
      AxiosError.ERR_NETWORK,
      config
    );
  }

  const status = Number(result.status || 200);

  const response: AxiosResponse = {
    data: result.body,
    status,
    statusText: "",
    headers: {},
    config,
  };

  console.log("[KOOKAL API] Response:", status, result.body);

  if (status < 200 || status >= 300) {
    const message =
      (result.body as { error?: string })?.error ||
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
