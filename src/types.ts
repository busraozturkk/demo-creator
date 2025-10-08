import { AuthService } from './auth';

export interface HttpMethod {
  GET: 'GET';
  POST: 'POST';
  PUT: 'PUT';
  DELETE: 'DELETE';
  PATCH: 'PATCH';
}

export type HttpMethodType = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export type ApiResponse<T = any> = T & {
  data?: T;
  id?: number;
  message?: string;
  status?: number;
  [key: string]: any;
}

export interface ApiClientInterface {
  executeRequest<T = any>(
    method: HttpMethodType,
    endpoint: string,
    data?: any,
    customHeaders?: Record<string, string>
  ): Promise<ApiResponse<T>>;
  setPartnerId(partnerId: string): void;
  getAppApiUrl(): string;
  getBearerToken(): string;
}

export interface EmployeeMapping {
  email: string;
  id: number;
  first_name: string;
  last_name: string;
  gender: string;
  started_at: string;
  user_id?: number;
  participate_in_projects?: boolean;
}

export interface DepartmentMapping {
  name: string;
  id: number;
  leader_employee_id: number;
}

export interface OfficeMapping {
  name: string;
  id: number;
}

export interface ProjectMapping {
  name: string;
  id: number;
}

export interface MilestoneMapping {
  name: string;
  id: number;
  project_id: number;
}
