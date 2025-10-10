import { ApiClient } from '../../../api-client';
import { CsvLoader, Employee, EmployeeDetail, EmployeeDetailWithIds } from '../../../utils/csv-loader';
import { HrReferenceDataOperation } from '../hr-settings/hr-reference-data';
import { OfficesOperation } from '../hr-settings/offices';
import { BaseOperation } from '../../utilities/base-operation';
import {
  DEFAULT_USER_ROLE_ID,
  MULTIPART_BOUNDARY,
  EXTERNAL_MODEL_TYPES,
  CACHE_PATHS
} from '../../../utils/constants';
import { EmployeeMapping } from '../../../types';
import * as path from 'path';

export class EmployeesOperation extends BaseOperation {
  private hrApiClient: ApiClient;
  private mainApiClient: ApiClient;
  private hrReferenceDataOp: HrReferenceDataOperation;
  private officesOp: OfficesOperation;

  constructor(hrApiClient: ApiClient, hrReferenceDataOp: HrReferenceDataOperation, officesOp: OfficesOperation, mainApiClient: ApiClient) {
    super();
    this.hrApiClient = hrApiClient;
    this.mainApiClient = mainApiClient;
    this.hrReferenceDataOp = hrReferenceDataOp;
    this.officesOp = officesOp;
  }

  private convertToIds(detail: EmployeeDetail): EmployeeDetailWithIds {
    const hrData = this.hrReferenceDataOp.getCachedData();
    if (!hrData) {
      throw new Error('HR reference data not found. Please ensure HR data is cached.');
    }

    const officeMappings = this.officesOp.getOfficeMappings();
    if (!officeMappings) {
      throw new Error('Office mappings not found. Please ensure offices are created first.');
    }

    // Find gender ID by name (case insensitive)
    const gender = hrData.genders.find(
      g => g.name.toLowerCase() === detail.gender_name.toLowerCase()
    );
    if (!gender) {
      throw new Error(`Gender '${detail.gender_name}' not found in HR reference data`);
    }

    // Find occupation ID by name
    const occupation = hrData.occupations.find(
      o => o.name.toLowerCase() === detail.occupation_name.toLowerCase()
    );
    if (!occupation) {
      throw new Error(`Occupation '${detail.occupation_name}' not found in HR reference data`);
    }

    // Find office ID by name
    const office = officeMappings.find(
      o => o.name.toLowerCase() === detail.office_name.toLowerCase()
    );
    if (!office) {
      throw new Error(`Office '${detail.office_name}' not found in office mappings`);
    }

    const detailWithIds: any = {
      email_username: detail.email_username,
      gender_id: gender.id,
      birthdate: detail.birthdate,
      citizenship_country_id: detail.citizenship_country_id,
      birth_place: detail.birth_place,
      office_id: office.id,
      work_type: detail.work_type,
      work_location: detail.work_location,
      occupation_id: occupation.id,
      personnel_number: detail.personnel_number,
      working_days: detail.working_days,
      vacation_day_number_type: detail.vacation_day_number_type,
      is_shareholder: detail.is_shareholder,
    };

    if (detail.iban) {
      detailWithIds.iban = detail.iban;
    }

    if (detail.title_name) {
      const title = hrData.titles.find(
        t => t.name.toLowerCase() === detail.title_name!.toLowerCase()
      );
      if (title) {
        detailWithIds.title_id = title.id;
      }
    }

    if (detail.contractual_partner_id) {
      detailWithIds.contractual_partner_id = detail.contractual_partner_id;
    }

    if (detail.rndDetails) {
      detailWithIds.rndDetails = detail.rndDetails;
    }

    return detailWithIds as EmployeeDetailWithIds;
  }

    async createEmployees(
        csvPath: string,
        emailDomain: string,
        options?: { ownerEmail?: string }   // <— NEW (optional)
    ): Promise<EmployeeMapping[]> {
        console.log(`Loading employees from: ${csvPath}`);
        const employees = CsvLoader.loadEmployees(csvPath);

        console.log(`Found ${employees.length} employees to create\n`);

        const mappings: EmployeeMapping[] = [];

        for (let i = 0; i < employees.length; i++) {
            const employee = employees[i];
            console.log(
                `[${i + 1}/${employees.length}] Creating: ${employee.first_name} ${employee.last_name} (${(employee as any).gender || 'n/a'})`
            );

            try {
                const response = await this.hrApiClient.executeRequest(
                    'POST',
                    '/api/employees/',
                    {
                        first_name: employee.first_name,
                        last_name: employee.last_name,
                        started_at: (employee as any).started_at,
                    }
                );

                console.log(`  Employee created (ID: ${response.id})`);

                const working_email = `${(employee as any).email_username}@${emailDomain}`;

                // Detect owner:
                // 1) CSV flags: is_owner / owner / isOwner
                // 2) options.ownerEmail fallback
                const rawIsOwner =
                    (employee as any).is_owner ??
                    (employee as any).owner ??
                    (employee as any).isOwner;

                const isOwnerFlag =
                    typeof rawIsOwner === 'string'
                        ? ['1', 'true', 'yes', 'owner'].includes(rawIsOwner.toLowerCase())
                        : !!rawIsOwner;

                const ownerEmailMatch =
                    options?.ownerEmail &&
                    working_email.toLowerCase() === options.ownerEmail.toLowerCase();

                const shouldEnableTimeTracking = isOwnerFlag || !!ownerEmailMatch;

                // Create user for this employee
                let userId: number | undefined;
                try {
                    const userResponse = await this.mainApiClient.executeRequest(
                        'POST',
                        '/auth/innos/add-user',
                        {
                            first_name: employee.first_name,
                            last_name: employee.last_name,
                            email: working_email,
                            phone_number: '',
                            roles: [DEFAULT_USER_ROLE_ID],
                        }
                    );

                    userId = userResponse.id || userResponse.data?.id || userResponse.user?.id;
                    if (!userId) {
                        console.error(`  User response:`, JSON.stringify(userResponse, null, 2));
                        throw new Error('User ID not found in response');
                    }

                    console.log(`  User created (ID: ${userId})`);

                    // Assign employee to user
                    try {
                        // Build multipart/form-data body manually
                        let body = '';

                        body += `--${MULTIPART_BOUNDARY}\r\n`;
                        body += `Content-Disposition: form-data; name="profile[external_model_id]"\r\n\r\n`;
                        body += `${response.id}\r\n`;

                        body += `--${MULTIPART_BOUNDARY}\r\n`;
                        body += `Content-Disposition: form-data; name="profile[external_model_type]"\r\n\r\n`;
                        body += `${EXTERNAL_MODEL_TYPES.EMPLOYEE}\r\n`;

                        body += `--${MULTIPART_BOUNDARY}--\r\n`;

                        await this.mainApiClient.executeRequest(
                            'PUT',
                            `/auth/users/${userId}`,
                            body,
                            {
                                'content-type': `multipart/form-data; boundary=${MULTIPART_BOUNDARY}`,
                            }
                        );
                        console.log(`  Employee assigned to user`);

                        // Activate user
                        try {
                            await this.mainApiClient.executeRequest(
                                'POST',
                                `/auth/users/${userId}/activate`
                            );
                            console.log(`  User activated`);
                        } catch (activateError) {
                            console.error(`  Error: Failed to activate user`);
                            console.error(`    ${activateError}\n`);
                        }

                        // Enable time tracking mode ONLY for owner
                        if (shouldEnableTimeTracking) {
                            try {
                                await this.mainApiClient.executeRequest(
                                    'POST',
                                    `/pct/api/users/${userId}/settings`,
                                    { time_entry_mode: 1 }
                                );
                                console.log(`  Time tracking mode enabled (owner)\n`);
                            } catch (timeTrackingError) {
                                console.error(`  Error: Failed to enable time tracking mode (owner)`);
                                console.error(`    ${timeTrackingError}\n`);
                            }
                        } else {
                            console.log(`  Time tracking mode skipped (not owner)\n`);
                        }
                    } catch (assignError) {
                        console.error(`  Error: Failed to assign employee to user`);
                        console.error(`    ${assignError}\n`);
                    }
                } catch (userError) {
                    console.error(`  Error: Failed to create user for ${working_email}`);
                    console.error(`    ${userError}\n`);
                }

                mappings.push({
                    email: working_email,
                    id: response.id,
                    first_name: employee.first_name,
                    last_name: employee.last_name,
                    gender: (employee as any).gender,
                    started_at: (employee as any).started_at,
                    user_id: userId, // keep user id
                });
            } catch (error) {
                console.error(
                    `Failed to create employee: ${employee.first_name} ${employee.last_name}`
                );
                console.error('Error details:', error);
                if (error instanceof Error) {
                    console.error('Error message:', error.message);
                    console.error('Error stack:', error.stack);
                }
                console.log();
            }
        }

        console.log(`Completed! Processed ${employees.length} employees.`);
        console.log(`Created ${mappings.length} employees with IDs\n`);

        if (mappings.length > 0) {
            this.saveMappings(mappings);
        } else {
            console.log('No new employees created, keeping existing mappings\n');
        }

        return mappings;
    }

    private saveMappings(mappings: EmployeeMapping[]): void {
    // Load existing mappings (may include owner employee) and merge
    const existingMappings = this.loadFromCache<EmployeeMapping[]>(CACHE_PATHS.EMPLOYEE_MAPPINGS) || [];

    // Merge: keep existing ones not in new mappings, then add new mappings
    const existingEmails = new Set(mappings.map(m => m.email));
    const mergedMappings = [
      ...existingMappings.filter(m => !existingEmails.has(m.email)),
      ...mappings
    ];

    this.saveToCache(CACHE_PATHS.EMPLOYEE_MAPPINGS, mergedMappings);

    if (existingMappings.length > 0) {
      console.log(`Saved ${mergedMappings.length} employee mappings to: ${CACHE_PATHS.EMPLOYEE_MAPPINGS} (includes ${existingMappings.length} existing employees)\n`);
    } else {
      console.log(`Saved ${mergedMappings.length} employee mappings to: ${CACHE_PATHS.EMPLOYEE_MAPPINGS}\n`);
    }
  }

  getMappings(): EmployeeMapping[] | null {
    return this.loadFromCache<EmployeeMapping[]>(CACHE_PATHS.EMPLOYEE_MAPPINGS);
  }

  async updateEmployeeDetails(csvPath: string, emailDomain: string): Promise<void> {
    console.log(`Loading employee details from: ${csvPath}`);
    const employeeDetails = CsvLoader.loadEmployeeDetails(csvPath);

    // Load employee ID mappings
    const mappings = this.getMappings();
    if (!mappings || mappings.length === 0) {
      console.error('No employee mappings found. Please create employees first.\n');
      return;
    }

    console.log(`Found ${employeeDetails.length} employee details to update\n`);

    for (let i = 0; i < employeeDetails.length; i++) {
      const detail = employeeDetails[i];

      // Build full email from username and domain
      const fullEmail = `${detail.email_username}@${emailDomain}`;

      // Find employee ID by email
      const mapping = mappings.find(m => m.email === fullEmail);
      if (!mapping) {
        console.log(`[${i + 1}/${employeeDetails.length}] Skipping: ${fullEmail} (employee not found in mappings)`);
        continue;
      }

      console.log(`[${i + 1}/${employeeDetails.length}] Updating: ${mapping.first_name} ${mapping.last_name} (ID: ${mapping.id})`);

      try {
        // Convert names to IDs
        const detailWithIds = this.convertToIds(detail);

        // Remove email_username from payload and prepare update data with email
        const { email_username, ...updateData } = detailWithIds;

        // Add the full email address and participate_in_projects to the update data
        const dataWithEmail = {
          ...updateData,
          working_email: fullEmail,
          participate_in_projects: true  // Enable all employees to participate in project-management
        };

        await this.hrApiClient.executeRequest(
          'PUT',
          `/api/employees/${mapping.id}`,
          dataWithEmail
        );

        console.log(`Updated successfully with email: ${fullEmail}\n`);
      } catch (error) {
        console.error(`Failed to update: ${error}\n`);
      }
    }

    console.log(`Completed! Processed ${employeeDetails.length} employee details.`);
  }
}
