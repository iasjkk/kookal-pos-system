
import axios, {
  AxiosAdapter,
  AxiosError,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";

const API_TIMEOUT = 30000;

type AppsScriptResult = {
  status?: number;
  body?: unknown;
};

type AppsScriptRunner = {
  withSuccessHandler(
    callback: (result: AppsScriptResult) => void
  ): AppsScriptRunner;

  withFailureHandler(
    callback: (error: Error) => void
  ): AppsScriptRunner;

  bridgeDispatch(
    method: string,
    path: string,
    payload: Record<string, unknown>
  ): void;
};

declare global {
  interface Window {
    google?: {
      script?: {
        run: AppsScriptRunner;
      };
    };
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

function getAppsScriptRunner(): AppsScriptRunner {
  const runner = window.google?.script?.run;

  if (!runner) {
    throw new Error(
      "Google Apps Script runtime is unavailable. " +
      "Open KOOKAL POS using its Apps Script Web App URL."
    );
  }

  return runner;
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

  const path = config.url || "/";

  let result: AppsScriptResult;

  try {
    const runner = getAppsScriptRunner();

    result = await new Promise<AppsScriptResult>(
      (resolve, reject) => {
        let completed = false;

        const timeout = setTimeout(() => {
          if (completed) return;

          completed = true;

          reject(
            new Error(
              "KOOKAL API request timed out. Please try again."
            )
          );
        }, API_TIMEOUT);

        runner
          .withSuccessHandler((response) => {
            if (completed) return;

            completed = true;
            clearTimeout(timeout);
            resolve(response || {});
          })
          .withFailureHandler((error) => {
            if (completed) return;

            completed = true;
            clearTimeout(timeout);

            reject(
              error instanceof Error
                ? error
                : new Error("Apps Script request failed.")
            );
          })
          .bridgeDispatch(method, path, payload);
      }
    );
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
