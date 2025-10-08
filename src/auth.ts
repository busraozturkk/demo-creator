import { DEFAULT_HEADERS, CONTENT_TYPES } from './utils/constants';

interface LoginResponse {
  data?: {
    access_token?: string;
  };
}

interface JwtPayload {
  sub: number;
  [key: string]: any;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export class AuthService {
  private bearerToken: string | null = null;
  private loginUrl: string;
  private userId: number | null = null;
  private email: string | null = null;

  constructor(loginUrl: string) {
    this.loginUrl = loginUrl;
  }

  async login(email: string, password: string): Promise<string> {
    this.email = email; // Store email for later use
    try {
      console.log(`Attempting login to: ${this.loginUrl}`);
      console.log(`Email: ${email}`);

      const response = await fetch(this.loginUrl, {
        method: 'POST',
        headers: {
          'accept': CONTENT_TYPES.JSON,
          'accept-language': DEFAULT_HEADERS.acceptLanguage,
          'content-type': CONTENT_TYPES.JSON,
          'origin': DEFAULT_HEADERS.origin,
          'referer': DEFAULT_HEADERS.referer,
          'user-agent': DEFAULT_HEADERS.userAgent,
        },
        body: JSON.stringify({
          email,
          password,
          remember_me: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new AuthError(
          `Login failed: ${response.status} - ${errorText}`,
          response.status
        );
      }

      const data: LoginResponse = await response.json();

      this.bearerToken = data.data?.access_token ?? null;

      if (!this.bearerToken) {
        throw new AuthError(
          'Token not found in response: ' + JSON.stringify(data)
        );
      }

      this.userId = this.extractUserIdFromToken(this.bearerToken);

      return this.bearerToken;
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }
      // More detailed error logging
      if (error instanceof Error) {
        console.error('Login error details:', {
          message: error.message,
          stack: error.stack,
          cause: (error as any).cause
        });
      }
      throw new AuthError(`Login failed: ${error}`);
    }
  }

  private extractUserIdFromToken(token: string): number {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWT format');
      }

      const payload = parts[1];
      const decoded: JwtPayload = JSON.parse(
        Buffer.from(payload, 'base64').toString()
      );

      if (typeof decoded.sub !== 'number') {
        throw new Error('Invalid user ID in token');
      }

      return decoded.sub;
    } catch (error) {
      throw new AuthError(`Failed to decode token: ${error}`);
    }
  }

  getUserId(): number {
    if (this.userId === null) {
      throw new AuthError('User ID not available. Please login first.');
    }
    return this.userId;
  }

  getEmail(): string | null {
    return this.email;
  }

  getBearerToken(): string {
    if (this.bearerToken === null) {
      throw new AuthError('Not authenticated. Please login first.');
    }
    return this.bearerToken;
  }

  setBearerToken(token: string): void {
    this.bearerToken = token;
    this.userId = this.extractUserIdFromToken(token);
  }

  setEmail(email: string): void {
    this.email = email;
  }

  isAuthenticated(): boolean {
    return this.bearerToken !== null;
  }
}
