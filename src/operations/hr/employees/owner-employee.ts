import { ApiClient } from '../../../api-client';
import { AuthService } from '../../../auth';
import { BaseOperation } from '../../utilities/base-operation';
import { EmployeeMapping } from '../../../types';
import { CACHE_PATHS } from '../../../utils/constants';
import * as fs from 'fs';
import { HrReferenceDataOperation } from '../hr-settings/hr-reference-data';
import { LegalRequirementsOperation } from '../../time-tracking/legal-requirements';

export class OwnerEmployeeOperation extends BaseOperation {
  private apiClient: ApiClient;
  private hrApiClient: ApiClient;
  private authService: AuthService;

  constructor(apiClient: ApiClient, hrApiClient: ApiClient, authService: AuthService) {
    super();
    this.apiClient = apiClient;
    this.hrApiClient = hrApiClient;
    this.authService = authService;
  }

  async createOwnerEmployee(avatarPath?: string, ownerDetails?: {
    gender?: string;
    birth_date?: string;
    nationality?: string;
    occupation_name?: string;
    title_name?: string;
  }): Promise<number> {
    console.log('Creating employee record for account owner');

    // Fetch current user information
    const userInfoResponse: any = await this.apiClient.executeRequest('GET', `/auth/users/${this.authService.getUserId()}`);

    // Handle different response structures - try multiple paths
    const userInfo = userInfoResponse.data || userInfoResponse;
    const userName = userInfo.name || userInfoResponse.name || 'Owner User';
    const userId = userInfo.id || userInfoResponse.id;

    // Try different paths for email (API response or fallback to auth service)
    const userEmail = userInfo.email ||
                      userInfoResponse.email ||
                      userInfo.data?.email ||
                      this.authService.getEmail();

    if (!userEmail) {
      throw new Error('Unable to extract user email from API response. Please ensure login was successful.');
    }

    console.log(`Owner: ${userName} (ID: ${userId}, Email: ${userEmail})`);

    // Split name into first and last name
    const nameParts = userName.trim().split(' ');
    const ownerFirstName = nameParts[0];
    const ownerLastName = nameParts.slice(1).join(' ') || nameParts[0];

    console.log(`Creating employee: ${ownerFirstName} ${ownerLastName}`);

    // Create employee
    const ownerEmployeeResponse = await this.hrApiClient.executeRequest(
      'POST',
      '/api/employees/',
      {
        first_name: ownerFirstName,
        last_name: ownerLastName,
        started_at: new Date().toISOString().split('T')[0],
      }
    );

    const ownerEmployeeId = ownerEmployeeResponse.id;
    console.log(`Owner employee created (ID: ${ownerEmployeeId})`);

    // Assign employee to current user using multipart/form-data
    const ownerBoundary = '----WebKitFormBoundaryjh5W5bFk4QoAnAr6';
    let ownerBody = '';
    ownerBody += `--${ownerBoundary}\r\n`;
    ownerBody += `Content-Disposition: form-data; name="profile[external_model_id]"\r\n\r\n`;
    ownerBody += `${ownerEmployeeId}\r\n`;
    ownerBody += `--${ownerBoundary}\r\n`;
    ownerBody += `Content-Disposition: form-data; name="profile[external_model_type]"\r\n\r\n`;
    ownerBody += `App\\Models\\Employee\\Employee\r\n`;
    ownerBody += `--${ownerBoundary}--\r\n`;

    await this.apiClient.executeRequest(
      'PUT',
      `/auth/users/${userId}`,
      ownerBody,
      {
        'content-type': `multipart/form-data; boundary=${ownerBoundary}`
      }
    );
    console.log('Owner employee assigned to user');

    // Update employee details with email and basic info
    const today = new Date().toISOString().split('T')[0];

    // Prepare employee details update payload
    const employeeUpdateData: any = {
      working_email: userEmail,
      participate_in_projects: true,  // Enable owner to participate in project-management
    };

    // Add optional details if provided
    if (ownerDetails) {
      if (ownerDetails.gender) {
        employeeUpdateData.gender = ownerDetails.gender;
      }
      if (ownerDetails.birth_date) {
        employeeUpdateData.birth_date = ownerDetails.birth_date;
      }
      if (ownerDetails.nationality) {
        employeeUpdateData.nationality = ownerDetails.nationality;
      }
      if (ownerDetails.occupation_name) {
        // Note: occupation_name would need to be converted to occupation_id
        // This will be handled if we have reference data available
        console.log(`Note: Occupation '${ownerDetails.occupation_name}' will need to be set via reference data`);
      }
      if (ownerDetails.title_name) {
        // Note: title_name would need to be converted to title_id
        console.log(`Note: Title '${ownerDetails.title_name}' will need to be set via reference data`);
      }
    }

    await this.hrApiClient.executeRequest(
      'PUT',
      `/api/employees/${ownerEmployeeId}`,
      employeeUpdateData
    );
    console.log(`Owner employee details updated with email: ${userEmail}`);

    // Contract, RnD details will be created separately via updateOwnerEmployeeContract()
    console.log('Note: Contract details will be added separately');

    // Note: Avatar upload for owner is done at the end with all other employees
    // to prevent deletion during subsequent user assignment operations

    // Save owner employee to cache so it's included in all subsequent operations
    const ownerEmployeeMapping: EmployeeMapping = {
      email: userEmail,
      id: ownerEmployeeId,
      user_id: userId,
      first_name: ownerFirstName,
      last_name: ownerLastName,
      gender: 'male', // Default, will be updated if needed
      started_at: today,
      participate_in_projects: true
    };

    // Load existing employee mappings and add owner (or create new array)
    let employeeMappings: EmployeeMapping[] = this.loadFromCache<EmployeeMapping[]>(CACHE_PATHS.EMPLOYEE_MAPPINGS) || [];

    // Check if owner already exists in cache (by user_id or email)
    const existingOwnerIndex = employeeMappings.findIndex(m =>
      m.user_id === userId || m.email === userEmail
    );

    if (existingOwnerIndex >= 0) {
      // Update existing owner entry
      employeeMappings[existingOwnerIndex] = ownerEmployeeMapping;
      console.log('Updated existing owner employee in cache');
    } else {
      // Add new owner entry
      employeeMappings.push(ownerEmployeeMapping);
      console.log('Added owner employee to cache');
    }

    this.saveToCache(CACHE_PATHS.EMPLOYEE_MAPPINGS, employeeMappings);
    console.log(`Total employees in cache: ${employeeMappings.length} (will be included in all subsequent operations)`);
    console.log('Owner employee setup completed successfully');
    return ownerEmployeeId;
  }

  /**
   * Update owner employee with full details using HR reference data
   */
  async updateOwnerEmployeeDetails(hrReferenceDataOp: HrReferenceDataOperation): Promise<void> {
    console.log('Updating owner employee with default details\n');

    // Load employee mappings to find owner
    const employeeMappings = this.loadFromCache<EmployeeMapping[]>(CACHE_PATHS.EMPLOYEE_MAPPINGS) || [];
    const currentUserId = this.authService.getUserId();
    console.log(`Looking for owner employee with user_id: ${currentUserId}`);
    console.log(`Total employees in cache: ${employeeMappings.length}`);

    if (employeeMappings.length > 0) {
      console.log('Employee mappings in cache:', employeeMappings.map(e => ({
        id: e.id,
        name: `${e.first_name} ${e.last_name}`,
        user_id: e.user_id,
        email: e.email
      })));
    }

    const ownerEmployee = employeeMappings.find(m => m.user_id === currentUserId);

    if (!ownerEmployee) {
      console.log(`Owner employee not found in cache for user_id: ${currentUserId}, skipping details update\n`);
      return;
    }

    console.log(`Found owner employee: ${ownerEmployee.first_name} ${ownerEmployee.last_name} (ID: ${ownerEmployee.id}, user_id: ${ownerEmployee.user_id})`);

    const hrData = hrReferenceDataOp.getCachedData();
    if (!hrData) {
      console.log('HR reference data not available, skipping details update\n');
      return;
    }

    console.log(`Updating details for: ${ownerEmployee.first_name} ${ownerEmployee.last_name} (ID: ${ownerEmployee.id})`);

    try {
      // Find default/first occupation and title
      const defaultOccupation = hrData.occupations && hrData.occupations.length > 0
        ? hrData.occupations[0]
        : null;
      const defaultTitle = hrData.titles && hrData.titles.length > 0
        ? hrData.titles[0]
        : null;
      const defaultGender = hrData.genders && hrData.genders.length > 0
        ? hrData.genders[0]
        : null;

      // Load office mappings from cache
      const officeMappings = this.loadFromCache<any[]>('./data/cache/office-mappings.json') || [];
      const defaultOffice = officeMappings.length > 0 ? officeMappings[0] : null;

      const updateData: any = {};

      if (defaultGender) {
        updateData.gender_id = defaultGender.id;
        console.log(`  Setting gender: ${defaultGender.name}`);
      }

      if (defaultOccupation) {
        updateData.occupation_id = defaultOccupation.id;
        console.log(`  Setting occupation: ${defaultOccupation.name}`);
      }

      if (defaultTitle) {
        updateData.title_id = defaultTitle.id;
        console.log(`  Setting title: ${defaultTitle.name}`);
      }

      if (defaultOffice) {
        updateData.office_id = defaultOffice.id;
        console.log(`  Setting office: ${defaultOffice.name}`);
      }

      // Add default birth date (30 years ago)
      const birthDate = new Date();
      birthDate.setFullYear(birthDate.getFullYear() - 30);
      updateData.birthdate = birthDate.toISOString().split('T')[0];
      console.log(`  Setting birth date: ${updateData.birthdate}`);

      // Add default nationality (Germany/Deutschland)
      const germany = hrData.countries?.find(c =>
        c.name.toLowerCase() === 'germany' ||
        c.name.toLowerCase() === 'deutschland'
      );
      if (germany) {
        updateData.nationality_id = germany.id;
        updateData.citizenship_country_id = germany.id;
        console.log(`  Setting nationality/citizenship: ${germany.name}`);
      }

      // Add default birth place
      updateData.birth_place = 'Berlin';
      console.log(`  Setting birth place: Berlin`);

      // Add default IBAN (German format example)
      updateData.iban = 'DE89370400440532013000';
      console.log(`  Setting IBAN: DE89370400440532013000`);

      // Add work type and location
      updateData.work_type = 1; // Remote/Office
      updateData.work_location = 'Germany';
      console.log(`  Setting work type: Office, work location: Germany`);

      // Add personnel number (random 4 digits)
      updateData.personnel_number = Math.floor(1000 + Math.random() * 9000).toString();
      console.log(`  Setting personnel number: ${updateData.personnel_number}`);

      // Add working days (Monday to Friday)
      updateData.working_days = [0, 1, 2, 3, 4];
      console.log(`  Setting working days: Monday to Friday`);

      // Add vacation day number type
      updateData.vacation_day_number_type = 'per_year';
      console.log(`  Setting vacation day number type: per_year`);

      // Add is_shareholder flag
      updateData.is_shareholder = false;
      console.log(`  Setting is_shareholder: false`);

      // Update employee with details
      await this.hrApiClient.executeRequest(
        'PUT',
        `/api/employees/${ownerEmployee.id}`,
        updateData
      );

      console.log('Owner employee details updated successfully\n');
    } catch (error: any) {
      console.error(`Failed to update owner employee details: ${error.message}\n`);
    }
  }

  /**
   * Create contract for owner employee
   * Returns the contract start date for salary record creation
   */
  async updateOwnerEmployeeContract(
    hrReferenceDataOp: HrReferenceDataOperation,
    legalRequirementsOp: LegalRequirementsOperation
  ): Promise<string | null> {
    console.log('Creating contract for owner employee\n');

    // Load employee mappings to find owner
    const employeeMappings = this.loadFromCache<EmployeeMapping[]>(CACHE_PATHS.EMPLOYEE_MAPPINGS) || [];
    const currentUserId = this.authService.getUserId();
    console.log(`Looking for owner employee with user_id: ${currentUserId}`);
    console.log(`Total employees in cache: ${employeeMappings.length}`);

    const ownerEmployee = employeeMappings.find(m => m.user_id === currentUserId);

    if (!ownerEmployee) {
      console.log(`Owner employee not found in cache for user_id: ${currentUserId}, skipping contract creation`);
      console.log('Available employees:', employeeMappings.map(e => ({
        name: `${e.first_name} ${e.last_name}`,
        user_id: e.user_id
      })));
      return null;
    }

    console.log(`Found owner employee: ${ownerEmployee.first_name} ${ownerEmployee.last_name} (ID: ${ownerEmployee.id}, user_id: ${ownerEmployee.user_id})`);

    const hrData = hrReferenceDataOp.getCachedData();
    const legalRequirementMappings = legalRequirementsOp.getMappings();

    if (!hrData || !legalRequirementMappings) {
      console.log('HR reference data or legal requirements not available, skipping contract creation\n');
      return null;
    }

    try {
      // Use employee's started_at date as contract start date (when they joined)
      // If started_at is today, use a date from 2-3 years ago for more realistic demo data
      const today = new Date();
      const startedAtDate = ownerEmployee.started_at ? new Date(ownerEmployee.started_at) : today;

      // If started_at is today (newly created), set it to 2-3 years ago
      let contractStartDate: Date;
      if (startedAtDate.toISOString().split('T')[0] === today.toISOString().split('T')[0]) {
        contractStartDate = new Date(today);
        contractStartDate.setFullYear(today.getFullYear() - 2 - Math.floor(Math.random() * 2)); // 2-3 years ago
      } else {
        contractStartDate = startedAtDate;
      }

      // Contract end date: 2-3 years in the future from today
      const contractEndDate = new Date(today);
      contractEndDate.setFullYear(today.getFullYear() + 2 + Math.floor(Math.random() * 2)); // 2-3 years in future

      const contractStartStr = contractStartDate.toISOString().split('T')[0];
      const contractEndStr = contractEndDate.toISOString().split('T')[0];

      // Find default/first values
      const defaultContractType = hrData.contractTypes && hrData.contractTypes.length > 0
        ? hrData.contractTypes[0]
        : null;
      const defaultQualificationGroup = hrData.qualificationGroups && hrData.qualificationGroups.length > 0
        ? hrData.qualificationGroups[0]
        : null;
      const defaultLegalRequirement = legalRequirementMappings && legalRequirementMappings.length > 0
        ? legalRequirementMappings[0]
        : null;

      if (!defaultContractType || !defaultQualificationGroup || !defaultLegalRequirement) {
        console.log('Missing required reference data for contract creation\n');
        return null;
      }

      // Probation end date: 2 months after contract start
      const probationEndDate = new Date(contractStartDate);
      probationEndDate.setMonth(probationEndDate.getMonth() + 2);
      const probationEndStr = probationEndDate.toISOString().split('T')[0];

      // Get employee's current data to retrieve their contract id
      console.log(`  Fetching employee data for ID: ${ownerEmployee.id}...`);
      const currentEmployee = await this.hrApiClient.executeRequest(
        'GET',
        `/api/employees/${ownerEmployee.id}`,
        { include: 'contract' }
      );
      console.log(`  Employee data fetched. Contract exists: ${!!currentEmployee.contract}`);

      // Create contract data matching the structure from EmployeeContractsOperation
      const contractData: any = {
        started_at: contractStartStr,
        end_at: contractEndStr,
        probation_ended_at: probationEndStr,
        legal_requirements_id: defaultLegalRequirement.id,
        type_id: defaultContractType.id,
        weekly_hours: 40,
        working_days: [0, 1, 2, 3, 4], // Monday to Friday (0-indexed)
        qualification_group_id: defaultQualificationGroup.id,
        annual_days_off: 24,
        is_current: true,
        vacation_day_number_type: 'per_year',
        vacation_restart_date: '1-1', // Vacation days restart on January 1st
        is_shareholder: false,
        contract_history: [],
        // RnD details
        rnd_ratio: 1.0,
        rnd_description: 'Software Development',
        // RnD meta
        max_yearly_pm: 10.5
      };

      // Add contract id if exists in current employee data
      if (currentEmployee.contract && currentEmployee.contract.id) {
        contractData.id = currentEmployee.contract.id;
        console.log(`  Found existing contract ID: ${currentEmployee.contract.id}`);
      } else if (currentEmployee.data?.contract?.id) {
        contractData.id = currentEmployee.data.contract.id;
        console.log(`  Found existing contract ID: ${currentEmployee.data.contract.id}`);
      } else {
        console.log(`  No existing contract found, creating new one`);
      }

      // Update employee with contract data
      await this.hrApiClient.executeRequest(
        'PUT',
        `/api/employees/${ownerEmployee.id}`,
        contractData
      );

      console.log('Owner employee contract created successfully');
      console.log(`  - Contract start: ${contractStartStr}`);
      console.log(`  - Contract end: ${contractEndStr}`);
      console.log(`  - Probation ended: ${probationEndStr}`);
      console.log(`  - Contract type: ${defaultContractType.name}`);
      console.log(`  - Weekly hours: 40`);
      console.log(`  - Annual days off: 24`);
      console.log(`  - R&D ratio: 100%`);
      console.log(`  - Max yearly PM: 10.5\n`);

      return contractStartStr;

    } catch (error: any) {
      console.error(`Failed to create owner employee contract: ${error.message}\n`);
      return null;
    }
  }

  /**
   * Add salary record for owner employee
   */
  async addOwnerEmployeeSalary(annualSalary: number = 80000, contractStartDate?: string): Promise<void> {
    console.log('Adding salary record for owner employee\n');

    // Load employee mappings to find owner
    const employeeMappings = this.loadFromCache<EmployeeMapping[]>(CACHE_PATHS.EMPLOYEE_MAPPINGS) || [];
    const ownerEmployee = employeeMappings.find(m => m.user_id === this.authService.getUserId());

    if (!ownerEmployee) {
      console.log('Owner employee not found in cache, skipping salary record\n');
      return;
    }

    console.log(`Adding salary record for: ${ownerEmployee.first_name} ${ownerEmployee.last_name} (ID: ${ownerEmployee.id})`);

    try {
      // First, prefill salary records (this creates the salary record structure)
      console.log(`  Prefilling salary records...`);
      const salaryRecords: any = await this.hrApiClient.executeRequest(
        'POST',
        `/api/employees/${ownerEmployee.id}/salary-records/prefill`,
        null
      );

      console.log(`  Created ${salaryRecords.length} salary record(s)`);

      if (salaryRecords.length === 0) {
        console.log(`  No salary records created, skipping\n`);
        return;
      }

      // Update the first salary record with actual amount
      const record = salaryRecords[0];
      console.log(`  Updating salary record ${record.id}: €${annualSalary.toLocaleString()}`);

      await this.hrApiClient.executeRequest(
        'PUT',
        `/api/salary-records/${record.id}`,
        {
          employee_id: ownerEmployee.id,
          id: record.id,
          contract_history_id: null,
          start_at: record.start_at,
          end_at: record.end_at,
          taxable_income: annualSalary,
          type: record.type,
          wage_type: record.wage_type,
        }
      );

      console.log(`Owner employee salary record created:`);
      console.log(`  - Amount: €${annualSalary.toLocaleString()} annually`);
      console.log(`  - Started: ${record.start_at}`);
      console.log(`  - Ends: ${record.end_at}\n`);
    } catch (error: any) {
      console.error(`Failed to create owner employee salary record: ${error.message}\n`);
    }
  }
}
