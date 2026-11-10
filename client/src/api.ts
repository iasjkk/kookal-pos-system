
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

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
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

  const result = { ...payload };

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

function sendAppsScriptRequest(
  config: InternalAxiosRequestConfig
): Promise<AxiosResponse> {
  return new Promise((resolve, reject) => {
    const appsScript = (window as any).google?.script?.run;

    if (!appsScript) {
      reject(
        new AxiosError(
          "KOOKAL must be opened using its Google Apps Script web app URL.",
          AxiosError.ERR_NETWORK,
          config
        )
      );
      return;
    }

    const method = (config.method || "GET").toUpperCase();

    if (!["GET", "POST", "PATCH"].includes(method)) {
      reject(
        new AxiosError(
          `Unsupported API method: ${method}`,
          AxiosError.ERR_BAD_REQUEST,
          config
        )
      );
      return;
    }

    const path = config.url || "/";

    let payload: Record<string, unknown>;

    try {
      payload = getRequestPayload(config);
    } catch (error: any) {
      reject(
        new AxiosError(
          error.message || "Invalid API request payload.",
          AxiosError.ERR_BAD_REQUEST,
          config
        )
      );
      return;
    }

    const timeout = setTimeout(() => {
      reject(
        new AxiosError(
          "KOOKAL API request timed out. Please try again.",
          AxiosError.ETIMEDOUT,
          config
        )
      );
    }, API_TIMEOUT);

    const finish = (
      result: AppsScriptResult | null | undefined
    ) => {
      clearTimeout(timeout);

      const status = Number(result?.status || 200);

      const response: AxiosResponse = {
        data: result?.body,
        status,
        statusText: "",
        headers: {},
        config,
      };

      if (status >= 200 && status < 300) {
        resolve(response);
        return;
      }

      const message =
        (result?.body as { error?: string })?.error ||
        "KOOKAL API request failed.";

      reject(
        new AxiosError(
          message,
          status === 401
            ? AxiosError.ERR_BAD_REQUEST
            : AxiosError.ERR_BAD_RESPONSE,
          config,
          undefined,
          response
        )
      );
    };

    try {
      appsScript
        .withSuccessHandler(finish)
        .withFailureHandler((error: any) => {
          clearTimeout(timeout);

          reject(
            new AxiosError(
              error?.message || "Google Apps Script request failed.",
              AxiosError.ERR_BAD_RESPONSE,
              config
            )
          );
        })
        .bridgeDispatch(method, path, payload);
    } catch (error: any) {
      clearTimeout(timeout);

      reject(
        new AxiosError(
          error?.message || "Unable to call the KOOKAL backend.",
          AxiosError.ERR_NETWORK,
          config
        )
      );
    }
  });
}

const appsScriptAdapter: AxiosAdapter = async (config) => {
  return sendAppsScriptRequest(config);
};

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
