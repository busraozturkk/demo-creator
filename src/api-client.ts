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
    const token = this.authService.getBearerToken();

    // For GET requests, data can be query parameters
    let url = `${this.appApiUrl}${endpoint}`;
    let body: string | undefined;

    if (method === 'GET' && data && typeof data === 'object') {
      // Build query string from data object
      const queryParams = new URLSearchParams(data).toString();
      if (queryParams) {
        url += `?${queryParams}`;
      }
      body = undefined;
    } else {
      const headers = this.buildHeaders(customHeaders);
      body = this.buildBody(data, headers['content-type']);
    }

    const headers = this.buildHeaders(customHeaders);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
      });

      if (!response.ok) {
        await this.handleErrorResponse(response, endpoint);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new Error(`Network error while calling ${endpoint}: ${error}`);
    }
  }

  private buildHeaders(customHeaders?: Record<string, string>): Record<string, string> {
    const token = this.authService.getBearerToken();

    const headers: Record<string, string> = {
      'accept': DEFAULT_HEADERS.accept,
      'accept-language': DEFAULT_HEADERS.acceptLanguage,
      'authorization': `Bearer ${token}`,
      'content-type': CONTENT_TYPES.JSON,
      'origin': DEFAULT_HEADERS.origin,
      'referer': DEFAULT_HEADERS.referer,
      'user-agent': DEFAULT_HEADERS.userAgent,
    };

    if (this.partnerId) {
      headers['partner-id'] = this.partnerId;
    }

    if (customHeaders) {
      Object.assign(headers, customHeaders);
    }

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
