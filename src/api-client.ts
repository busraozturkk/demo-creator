import { AuthService } from './auth';
import { DEFAULT_HEADERS, CONTENT_TYPES } from './utils/constants';
import { HttpMethodType, ApiResponse } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public endpoint: string,
    public responseBody?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ApiClient {
  private authService: AuthService;
  private appApiUrl: string;
  private partnerId?: string;

  constructor(authService: AuthService, appApiUrl: string, partnerId?: string) {
    this.authService = authService;
    this.appApiUrl = appApiUrl;
    this.partnerId = partnerId;
  }

  setPartnerId(partnerId: string): void {
    this.partnerId = partnerId;
  }

    async executeRequest<T = any>(
        method: HttpMethodType,
        endpoint: string,
        data?: any,
        customHeaders?: Record<string, string>
    ): Promise<ApiResponse<T>> {

        let url = `${this.appApiUrl}${endpoint}`;
        let body: any = undefined;

        const upper = method.toUpperCase();

        const headers = this.buildHeaders(customHeaders);
        if (upper === 'GET' && data && typeof data === 'object') {
            const qs = new URLSearchParams();
            Object.entries(data).forEach(([k, v]) => {
                if (v === undefined || v === null) return;
                if (Array.isArray(v)) v.forEach(item => qs.append(k, String(item)));
                else qs.append(k, String(v));
            });
            const s = qs.toString();
            if (s) url += `?${s}`;
        } else if (data !== undefined && data !== null) {
            const ct = headers['content-type'] || CONTENT_TYPES.JSON;

            if (ct.includes(CONTENT_TYPES.MULTIPART_FORM_DATA)) {
                body = data;
                if (typeof FormData !== 'undefined' && data instanceof FormData) {
                    delete headers['content-type'];
                }
            } else if (ct.includes(CONTENT_TYPES.FORM_URLENCODED)) {
                body = typeof data === 'string' ? data : new URLSearchParams(data).toString();
            } else {
                headers['content-type'] = CONTENT_TYPES.JSON;
                body = typeof data === 'string' ? data : JSON.stringify(data);
            }
        } else {
            if (headers['content-type']) delete headers['content-type'];
        }

        try {
            const response = await fetch(url, { method: upper, headers, body });

            if (!response.ok) {
                await this.handleErrorResponse(response, endpoint);
            }

            const status = response.status;
            const contentType = response.headers.get('content-type') || '';
            const text = await response.text();

            if (status === 204 || !text || text.trim().length === 0) {
                return {} as ApiResponse<T>;
            }

            if (contentType.includes('application/json')) {
                try {
                    return JSON.parse(text) as ApiResponse<T>;
                } catch {
                    return {} as ApiResponse<T>;
                }
            }

            return text as unknown as ApiResponse<T>;
        } catch (error) {
            if (error instanceof ApiError) throw error;
            throw new Error(`Network error while calling ${endpoint}: ${error}`);
        }
    }


    private buildHeaders(customHeaders?: Record<string, string>): Record<string, string> {
        const token = this.authService.getBearerToken();

        const headers: Record<string, string> = {
            accept: DEFAULT_HEADERS.accept,
            'accept-language': DEFAULT_HEADERS.acceptLanguage,
            authorization: `Bearer ${token}`,
            origin: DEFAULT_HEADERS.origin,
            referer: DEFAULT_HEADERS.referer,
            'user-agent': DEFAULT_HEADERS.userAgent,
        };

        if (this.partnerId) {
            headers['partner-id'] = this.partnerId;
        }
        if (customHeaders) Object.assign(headers, customHeaders);
        return headers;
    }

    private buildBody(data: any, contentType: string): string | undefined {
    if (!data) {
      return undefined;
    }

    if (contentType.includes(CONTENT_TYPES.FORM_URLENCODED)) {
      return typeof data === 'string' ? data : new URLSearchParams(data).toString();
    }

    if (contentType.includes(CONTENT_TYPES.MULTIPART_FORM_DATA)) {
      return data; // Already formatted as string
    }

    return JSON.stringify(data);
  }

  private async handleErrorResponse(response: Response, endpoint: string): Promise<never> {
    const errorText = await response.text();
    throw new ApiError(
      `Request failed: ${response.status} ${response.statusText}`,
      response.status,
      endpoint,
      errorText
    );
  }

  getAppApiUrl(): string {
    return this.appApiUrl;
  }

  getBearerToken(): string {
    return this.authService.getBearerToken();
  }
}
