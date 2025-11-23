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

  async approveUserConsent(partnerId: string): Promise<void> {
    if (!this.bearerToken) {
      throw new AuthError('Not authenticated. Please login first.');
    }

    try {
      console.log('Approving user consent for device information...');

      const response = await fetch('https://task-management-backend.innoscripta.com/api/user-consents', {
        method: 'POST',
        headers: {
          'accept': CONTENT_TYPES.JSON,
          'accept-language': 'en',
          'content-type': CONTENT_TYPES.JSON,
          'authorization': `Bearer ${this.bearerToken}`,
          'partner-id': partnerId,
          'timezone': 'Europe/Istanbul',
          'origin': DEFAULT_HEADERS.origin,
          'referer': DEFAULT_HEADERS.referer,
          'user-agent': DEFAULT_HEADERS.userAgent,
        },
        body: JSON.stringify({
          consent_type: 'device_information_consent'
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new AuthError(
          `User consent approval failed: ${response.status} - ${errorText}`,
          response.status
        );
      }

      console.log('✓ User consent approved successfully');
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }
      throw new AuthError(`Failed to approve user consent: ${error}`);
    }
  }

  async generatePartnerToken(partnerId: number, apiBaseUrl: string): Promise<string> {
    if (!this.bearerToken) {
      throw new AuthError('Not authenticated. Please login first.');
    }

    try {
      console.log(`Generating partner token for partner ID: ${partnerId}`);

      const response = await fetch(`${apiBaseUrl}/generate-token-for-partner`, {
        method: 'POST',
        headers: {
          'accept': CONTENT_TYPES.JSON,
          'accept-language': 'en',
          'content-type': CONTENT_TYPES.JSON,
          'authorization': `Bearer ${this.bearerToken}`,
          'origin': DEFAULT_HEADERS.origin,
          'referer': DEFAULT_HEADERS.referer,
          'user-agent': DEFAULT_HEADERS.userAgent,
        },
        body: JSON.stringify({
          partner_id: partnerId
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new AuthError(
          `Partner token generation failed: ${response.status} - ${errorText}`,
          response.status
        );
      }

      const data = await response.json();
      const partnerToken = data.data?.token || data.token;

      if (!partnerToken) {
        throw new AuthError('Partner token not found in response: ' + JSON.stringify(data));
      }

      console.log('✓ Partner token generated successfully');
      return partnerToken;
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }
      throw new AuthError(`Failed to generate partner token: ${error}`);
    }
  }
}
