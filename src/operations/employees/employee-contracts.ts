import { ApiClient } from '../../api-client';
import { CsvLoader, EmployeeContract } from '../../utils/csv-loader';
import { HrReferenceDataOperation } from '../hr-data/hr-reference-data';
import { LegalRequirementsOperation } from '../hr-data/legal-requirements';

interface EmployeeMapping {
  email: string;
  id: number;
}

interface EmployeeContractWithIds {
  id?: number;
  title_id?: number;
  started_at: string;
  end_at: string;
  date_contract_signing?: string;
  legal_requirements_id: number;
  type_id: number;
  probation_ended_at?: string;
  vacation_restart_date?: string;
  weekly_hours: number;
  working_days: number[];
  qualification_group_id: number;
  annual_days_off: number;
  flexible_days?: number | null;
  flexible_days_per_week?: number;
  is_current: boolean;
  vacation_day_number_type: string;
  currency_id?: number;
  rnd_description?: string;
  is_shareholder: boolean;
  contract_history?: any[];
}

export class EmployeeContractsOperation {
  private apiClient: ApiClient;
  private hrReferenceDataOp: HrReferenceDataOperation;
  private legalRequirementsOp: LegalRequirementsOperation;

  constructor(
    apiClient: ApiClient,
    hrReferenceDataOp: HrReferenceDataOperation,
    legalRequirementsOp: LegalRequirementsOperation
  ) {
    this.apiClient = apiClient;
    this.hrReferenceDataOp = hrReferenceDataOp;
    this.legalRequirementsOp = legalRequirementsOp;
  }

  async updateEmployeeContracts(
    csvPath: string,
    employeeMappings: EmployeeMapping[],
    employeeDetailsPath?: string
  ): Promise<void> {
    console.log(`Loading employee contracts from: ${csvPath}`);
    const contracts = CsvLoader.loadEmployeeContracts(csvPath);

    // Load employee details to get working_days and title_name
    let employeeDetailsMap: Map<string, any> = new Map();
    if (employeeDetailsPath) {
      const employeeDetails = CsvLoader.loadEmployeeDetails(employeeDetailsPath);
      employeeDetails.forEach(detail => {
        employeeDetailsMap.set(detail.email_username, detail);
      });
    }

    console.log(`Found ${contracts.length} employee contracts to update\n`);

    for (let i = 0; i < contracts.length; i++) {
      const contract = contracts[i];
      console.log(`[${i + 1}/${contracts.length}] Updating contract for: ${contract.email_username}`);

      try {
        // Find employee ID
        const employee = employeeMappings.find(
          e => e.email.startsWith(contract.email_username)
        );

        if (!employee) {
          console.error(`Employee not found for username: ${contract.email_username}\n`);
          continue;
        }

        // Get employee's current data to retrieve their contract id
        // Use HR API to get employee with contract data
        console.log(`  Fetching employee data for ID: ${employee.id}...`);
        const currentEmployee = await this.apiClient.executeRequest(
          'GET',
          `/api/employees/${employee.id}`,
          { include: 'contract' }
        );
        console.log(`  Employee data fetched. Contract exists: ${!!currentEmployee.contract}`);

        // Convert contract to IDs
        const contractWithIds = this.convertToIds(contract);

        // Add working_days and title_id from employee details if available
        const employeeDetail = employeeDetailsMap.get(contract.email_username);
        if (employeeDetail) {
          if (employeeDetail.working_days) {
            contractWithIds.working_days = employeeDetail.working_days;
          } else {
            // Default working days (Monday to Friday)
            contractWithIds.working_days = [0, 1, 2, 3, 4];
          }

          // Add title_id if title_name exists in employee details
          if (employeeDetail.title_name) {
            const hrData = this.hrReferenceDataOp.getCachedData();
            if (hrData) {
              const title = hrData.titles.find(
                t => t.name.toLowerCase() === employeeDetail.title_name.toLowerCase()
              );
              if (title) {
                contractWithIds.title_id = title.id;
                console.log(`  Found title: ${employeeDetail.title_name} (ID: ${title.id})`);
              }
            }
          }
        } else {
          // Default working days (Monday to Friday)
          contractWithIds.working_days = [0, 1, 2, 3, 4];
        }

        // Add contract id if exists in current employee data
        if (currentEmployee.contract && currentEmployee.contract.id) {
          contractWithIds.id = currentEmployee.contract.id;
          console.log(`  Found existing contract ID: ${currentEmployee.contract.id}`);
        } else if (currentEmployee.data?.contract?.id) {
          contractWithIds.id = currentEmployee.data.contract.id;
          console.log(`  Found existing contract ID: ${currentEmployee.data.contract.id}`);
        } else {
          console.log(`  No existing contract found, creating new one`);
        }

        // Add empty contract_history
        contractWithIds.contract_history = [];

        // Log contract data being sent
        console.log(`  Contract data prepared:`, JSON.stringify({
          id: contractWithIds.id,
          title_id: contractWithIds.title_id,
          started_at: contractWithIds.started_at,
          end_at: contractWithIds.end_at,
          type_id: contractWithIds.type_id,
          qualification_group_id: contractWithIds.qualification_group_id,
          legal_requirements_id: contractWithIds.legal_requirements_id,
          currency_id: contractWithIds.currency_id
        }, null, 2));

        // Update employee contract via HR API
        // Based on curl example, use PUT /api/employees/{id} with contract data directly in body
        console.log(`  Updating contract via PUT /api/employees/${employee.id}...`);
        await this.apiClient.executeRequest(
          'PUT',
          `/api/employees/${employee.id}`,
          contractWithIds  // Send contract data directly, not nested
        );
        console.log(`  ✓ Contract updated successfully\n`);
      } catch (error) {
        console.error(`Failed to update contract: ${error}\n`);
      }
    }

    console.log(`Completed! Processed ${contracts.length} employee contracts.`);
  }

  private convertToIds(contract: EmployeeContract): EmployeeContractWithIds {
    const hrData = this.hrReferenceDataOp.getCachedData();
    const legalRequirementMappings = this.legalRequirementsOp.getMappings();

    if (!hrData) {
      throw new Error('HR reference data not cached. Run fetchAndCache first.');
    }

    if (!legalRequirementMappings) {
      throw new Error('Legal requirement mappings not cached. Run fetchAndCache first.');
    }

    // Find contract type ID by name
    const contractType = hrData.contractTypes.find(
      ct => ct.name.toLowerCase() === contract.contract_type_name.toLowerCase()
    );

    if (!contractType) {
      throw new Error(`Contract type not found: ${contract.contract_type_name}`);
    }

    // Find qualification group ID by name (use partial match for flexibility)
    const qualificationGroup = hrData.qualificationGroups.find(
      qg => {
        const qgNameLower = qg.name.toLowerCase();
        const searchNameLower = contract.qualification_group_name.toLowerCase();
        // Match if contract name is contained in qualification group name or vice versa
        return qgNameLower.includes(searchNameLower) || searchNameLower.includes(qgNameLower);
      }
    );

    if (!qualificationGroup) {
      throw new Error(`Qualification group not found: ${contract.qualification_group_name}`);
    }

    // Find legal requirement ID by country
    const legalRequirement = legalRequirementMappings.find(
      lr => lr.country_id === contract.legal_requirement_country_id
    );

    if (!legalRequirement) {
      throw new Error(`Legal requirement not found for country ID: ${contract.legal_requirement_country_id}`);
    }

    // Find EUR currency ID
    let currencyId = 3; // Default fallback
    if (hrData.currencies && hrData.currencies.length > 0) {
      const eurCurrency = hrData.currencies.find(c => c.short_name === 'EUR');
      if (eurCurrency) {
        currencyId = eurCurrency.id;
      }
    }

    const contractWithIds: EmployeeContractWithIds = {
      started_at: contract.started_at,
      end_at: contract.end_at,
      legal_requirements_id: legalRequirement.id,
      type_id: contractType.id,
      weekly_hours: contract.weekly_hours,
      working_days: [0, 1, 2, 3, 4], // Default, will be overridden in updateEmployeeContracts
      qualification_group_id: qualificationGroup.id,
      annual_days_off: contract.annual_days_off,
      is_current: contract.is_current,
      vacation_day_number_type: 'per_year', // Default
      is_shareholder: contract.is_shareholder,
      currency_id: currencyId,
    };

    // Set date_contract_signing to 5 days before started_at
    const startDate = new Date(contract.started_at);
    startDate.setDate(startDate.getDate() - 5);
    const year = startDate.getFullYear();
    const month = String(startDate.getMonth() + 1).padStart(2, '0');
    const day = String(startDate.getDate()).padStart(2, '0');
    contractWithIds.date_contract_signing = `${year}-${month}-${day}`;

    // Add optional fields
    if (contract.probation_ended_at) {
      contractWithIds.probation_ended_at = contract.probation_ended_at;
    }

    if (contract.vacation_restart_date) {
      contractWithIds.vacation_restart_date = contract.vacation_restart_date;
    } else {
      contractWithIds.vacation_restart_date = '01-01';
    }

    if (contract.flexible_days !== undefined) {
      contractWithIds.flexible_days = contract.flexible_days;
    } else {
      contractWithIds.flexible_days = null;
    }

    if (contract.flexible_days_per_week !== undefined) {
      contractWithIds.flexible_days_per_week = contract.flexible_days_per_week;
    } else {
      contractWithIds.flexible_days_per_week = 0;
    }

    if (contract.rnd_description) {
      contractWithIds.rnd_description = contract.rnd_description;
    }

    return contractWithIds;
  }
}
