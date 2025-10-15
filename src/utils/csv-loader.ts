import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as path from 'path';

export class CsvLoadError extends Error {
  constructor(
    message: string,
    public filePath: string,
    public line?: number
  ) {
    super(message);
    this.name = 'CsvLoadError';
  }
}

export interface QualificationGroup {
  name: string;
  name_de: string;
}

export interface OccupationGroup {
  name: string;
  name_de?: string;
}

export interface Department {
  name: string;
  name_de?: string;
}

export interface Occupation {
  department_name: string;
  name: string;
  name_de?: string;
}

export interface Title {
  name: string;
  name_de?: string;
}

export interface Office {
  is_main: boolean;
  name: string;
  country_id: number;
  state_id: number;
  city_id: number;
  postcode: string;
  street: string;
  building: string;
  phone: string;
  website: string;
  email: string;
  lat: string;
  lon: string;
  can_have_half_day: boolean;
  is_vacation_restart_disabled: boolean;
}

export interface LegalRequirement {
  title: string;
  country_id: number;
  working_days: number[];
  working_days_max_hours: number;
  non_working_days_max_hours: number;
  min_rest_hours: number;
  strict_level: string;
  breaks: Array<{
    min_working_hours: number;
    break_minutes: number;
    break_min_minutes: number;
  }>;
  default_weekly_working_hours: number;
  office_open_time: string;
  office_close_time: string;
}

export interface Employee {
  first_name: string;
  last_name: string;
  gender: string;
  started_at: string;
  email_username: string;
  require_working_email: boolean;
}

export interface EmployeeDetail {
  email_username: string;
  title_name?: string;
  gender_name: string;
  birthdate: string;
  citizenship_country_id: number[];
  birth_place: string;
  iban?: string;
  office_name: string;
  work_type: number;
  work_location: string;
  contractual_partner_id?: number;
  rndDetails?: {
    global_percentage: string;
  };
  occupation_name: string;
  personnel_number: string;
  working_days: number[];
  vacation_day_number_type: string;
  is_shareholder: boolean;
}

export interface EmployeeDetailWithIds {
  email_username: string;
  title_id?: number;
  gender_id: number;
  birthdate: string;
  citizenship_country_id: number[];
  birth_place: string;
  iban?: string;
  office_id: number;
  work_type: number;
  work_location: string;
  contractual_partner_id?: number;
  rndDetails?: {
    global_percentage: string;
  };
  occupation_id: number;
  personnel_number: string;
  working_days: number[];
  vacation_day_number_type: string;
  is_shareholder: boolean;
}

export interface EmployeeContract {
  email_username: string;
  started_at: string;
  end_at: string;
  legal_requirement_country_id: number;
  contract_type_name: string;
  probation_ended_at?: string;
  vacation_restart_date?: string;
  weekly_hours: number;
  qualification_group_name: string;
  annual_days_off: number;
  flexible_days?: number;
  flexible_days_per_week?: number;
  is_current: boolean;
  rnd_description?: string;
  is_shareholder: boolean;
}
export interface EmployeeSalary {
    email_username: string;
    annual_salary: number;
}

export class CsvLoader {
  /**
   * Base method to load and parse CSV files
   */
  private static loadCsv<T>(
    filePath: string,
    mapper: (record: any, index: number) => T
  ): T[] {
    try {
      const absolutePath = path.resolve(filePath);

      if (!fs.existsSync(absolutePath)) {
        throw new CsvLoadError(
          `File not found: ${absolutePath}`,
          filePath
        );
      }

      const fileContent = fs.readFileSync(absolutePath, 'utf-8');

      const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      return records.map((record: any, index: number) => {
        try {
          return mapper(record, index);
        } catch (error) {
          throw new CsvLoadError(
            `Error parsing row ${index + 1}: ${error}`,
            filePath,
            index + 1
          );
        }
      });
    } catch (error) {
      if (error instanceof CsvLoadError) {
        throw error;
      }
      throw new CsvLoadError(
        `Failed to load CSV file: ${error}`,
        filePath
      );
    }
  }

  static loadQualificationGroups(filePath: string): QualificationGroup[] {
    return this.loadCsv(filePath, (record) => ({
      name: record.name,
      name_de: record.name_de,
    }));
  }

  static loadOccupationGroups(filePath: string): OccupationGroup[] {
    return this.loadCsv(filePath, (record) => {
      const group: OccupationGroup = {
        name: record.name,
      };

      if (record.name_de) {
        group.name_de = record.name_de;
      }

      return group;
    });
  }

  static loadDepartments(filePath: string): Department[] {
    return this.loadCsv(filePath, (record) => {
      const department: Department = {
        name: record.name,
      };

      if (record.name_de) {
        department.name_de = record.name_de;
      }

      return department;
    });
  }

  static loadOccupations(filePath: string): Occupation[] {
    return this.loadCsv(filePath, (record) => {
      const occupation: Occupation = {
        department_name: record.department_name,
        name: record.name,
      };

      if (record.name_de) {
        occupation.name_de = record.name_de;
      }

      return occupation;
    });
  }

  static loadTitles(filePath: string): Title[] {
    return this.loadCsv(filePath, (record) => {
      const title: Title = {
        name: record.name,
      };

      if (record.name_de) {
        title.name_de = record.name_de;
      }

      return title;
    });
  }

  static loadOffices(filePath: string): Office[] {
    return this.loadCsv(filePath, (record) => ({
      is_main: record.is_main === 'true' || record.is_main === '1',
      name: record.name,
      country_id: parseInt(record.country_id, 10),
      state_id: parseInt(record.state_id, 10),
      city_id: parseInt(record.city_id, 10),
      postcode: record.postcode,
      street: record.street,
      building: record.building,
      phone: record.phone,
      website: record.website,
      email: record.email,
      lat: record.lat,
      lon: record.lon,
      can_have_half_day: record.can_have_half_day === 'true' || record.can_have_half_day === '1',
      is_vacation_restart_disabled: record.is_vacation_restart_disabled === 'true' || record.is_vacation_restart_disabled === '1',
    }));
  }

  static loadLegalRequirements(filePath: string): LegalRequirement[] {
    return this.loadCsv(filePath, (record) => ({
      title: record.title,
      country_id: parseInt(record.country_id, 10),
      working_days: record.working_days.split(',').map((d: string) => parseInt(d.trim(), 10)),
      working_days_max_hours: parseInt(record.working_days_max_hours, 10),
      non_working_days_max_hours: parseInt(record.non_working_days_max_hours, 10),
      min_rest_hours: parseInt(record.min_rest_hours, 10),
      strict_level: record.strict_level,
      breaks: JSON.parse(record.breaks),
      default_weekly_working_hours: parseInt(record.default_weekly_working_hours, 10),
      office_open_time: record.office_open_time,
      office_close_time: record.office_close_time,
    }));
  }

  static loadEmployees(filePath: string): Employee[] {
    return this.loadCsv(filePath, (record) => ({
      first_name: record.first_name,
      last_name: record.last_name,
      gender: record.gender,
      started_at: record.started_at,
      email_username: record.email_username,
      require_working_email: record.require_working_email === 'true' || record.require_working_email === '1',
    }));
  }

  static loadEmployeeDetails(filePath: string): EmployeeDetail[] {
    return this.loadCsv(filePath, (record) => {
      const detail: any = {
        email_username: record.email_username,
        gender_name: record.gender_name,
        birthdate: record.birthdate,
        citizenship_country_id: record.citizenship_country_id.split(',').map((id: string) => parseInt(id.trim(), 10)),
        birth_place: record.birth_place,
        office_name: record.office_name,
        work_type: parseInt(record.work_type, 10),
        work_location: record.work_location,
        occupation_name: record.occupation_name,
        personnel_number: record.personnel_number,
        working_days: record.working_days.split(',').map((d: string) => parseInt(d.trim(), 10)),
        vacation_day_number_type: record.vacation_day_number_type,
        is_shareholder: record.is_shareholder === 'true' || record.is_shareholder === '1',
      };

      if (record.iban?.trim()) {
        detail.iban = record.iban;
      }

      if (record.title_name?.trim()) {
        detail.title_name = record.title_name;
      }

      if (record.contractual_partner_id) {
        detail.contractual_partner_id = parseInt(record.contractual_partner_id, 10);
      }

      if (record.rnd_global_percentage) {
        detail.rndDetails = {
          global_percentage: record.rnd_global_percentage,
        };
      }

      return detail as EmployeeDetail;
    });
  }

  static loadEmployeeContracts(filePath: string): EmployeeContract[] {
    return this.loadCsv(filePath, (record) => {
      const contract: any = {
        email_username: record.email_username,
        started_at: record.started_at,
        end_at: record.end_at,
        legal_requirement_country_id: parseInt(record.legal_requirement_country_id, 10),
        contract_type_name: record.contract_type_name,
        weekly_hours: parseInt(record.weekly_hours, 10),
        qualification_group_name: record.qualification_group_name,
        annual_days_off: parseInt(record.annual_days_off, 10),
        is_current: record.is_current === 'true' || record.is_current === '1',
        is_shareholder: record.is_shareholder === 'true' || record.is_shareholder === '1',
      };

      if (record.probation_ended_at?.trim()) {
        contract.probation_ended_at = record.probation_ended_at;
      }

      if (record.vacation_restart_date?.trim()) {
        contract.vacation_restart_date = record.vacation_restart_date;
      }

      if (record.flexible_days?.trim()) {
        contract.flexible_days = parseInt(record.flexible_days, 10);
      }

      if (record.flexible_days_per_week?.trim()) {
        contract.flexible_days_per_week = parseInt(record.flexible_days_per_week, 10);
      }

      if (record.rnd_description?.trim()) {
        contract.rnd_description = record.rnd_description;
      }

      return contract as EmployeeContract;
    });
  }

  static loadEmployeeSalaries(csvPath: string): EmployeeSalary[] {
    return this.loadCsv(csvPath, (record) => ({
      email_username: record.email_username,
      annual_salary: parseInt(record.annual_salary, 10),
    }));
  }
}
