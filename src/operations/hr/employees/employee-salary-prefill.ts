import { ApiClient } from '../../../api-client';
import { CsvLoader, EmployeeSalary } from '../../../utils/csv-loader';
import * as fs from 'fs';

interface EmployeeMapping {
    email: string;
    id: number;
    first_name: string;
    last_name: string;
}

interface SalaryRecord {
    id: number;
    start_at: string;
    end_at: string;
    type: string;
    wage_type: string;
}

interface EmployerContribution {
    id: number;
    employee_id: number;
    start_date: string;
    end_date: string;
}

export class EmployeeSalaryPrefillOperation {
    private apiClient: ApiClient;
    private salaryData: Map<string, number> = new Map();

    constructor(apiClient: ApiClient) {
        this.apiClient = apiClient;
    }

    async loadSalaryData(csvPath: string): Promise<void> {
        if (!fs.existsSync(csvPath)) {
            console.log(`Warning: Salary data file not found: ${csvPath}`);
            console.log('Using default salary amounts\n');
            return;
        }

        console.log(`Loading salary data from: ${csvPath}`);
        const salaries = CsvLoader.loadEmployeeSalaries(csvPath);

        for (const salary of salaries) {
            this.salaryData.set(salary.email_username, salary.annual_salary);
        }

        console.log(`Loaded ${this.salaryData.size} salary records\n`);
    }

    private getSalaryForEmployee(email: string): number {
        // Extract username from email (before @)
        const username = email.split('@')[0];

        // Return salary from CSV or default to 60000
        return this.salaryData.get(username) || 60000;
    }

    private calculateEmployerContribution(annualSalary: number): number {
        // Calculate ~25% of annual salary as employer contribution
        // This is a typical German employer contribution percentage
        return Math.round(annualSalary * 0.25);
    }

    async prefillSalaryRecords(employeeMappings: EmployeeMapping[]): Promise<void> {
        console.log(`Starting salary records prefill for ${employeeMappings.length} employees\n`);

        let successCount = 0;
        let failedCount = 0;

        for (let i = 0; i < employeeMappings.length; i++) {
            const employee = employeeMappings[i];
            console.log(`[${i + 1}/${employeeMappings.length}] Prefilling salary for: ${employee.first_name} ${employee.last_name} (ID: ${employee.id})`);

            try {
                const salaryRecords = await this.prefillSalary(employee.id);
                console.log(`Created ${salaryRecords.length} salary record(s)\n`);

                // Update each salary record with actual amounts
                for (const record of salaryRecords) {
                    await this.updateSalaryRecord(employee, record);
                }

                successCount++;
            } catch (error) {
                console.error(`Error: Failed to prefill salary: ${error}\n`);
                failedCount++;
            }
        }

        console.log(`Completed! Success: ${successCount}, Failed: ${failedCount}`);
    }

    async prefillEmployerContributions(employeeMappings: EmployeeMapping[]): Promise<void> {
        console.log(`Starting employer contributions prefill for ${employeeMappings.length} employees\n`);

        let successCount = 0;
        let failedCount = 0;

        for (let i = 0; i < employeeMappings.length; i++) {
            const employee = employeeMappings[i];
            console.log(`[${i + 1}/${employeeMappings.length}] Prefilling employer contributions for: ${employee.first_name} ${employee.last_name} (ID: ${employee.id})`);

            try {
                const contributions = await this.prefillEmployerContribution(employee.id);
                console.log(`Created ${contributions.length} contribution record(s)\n`);

                // Update each contribution with actual amounts
                for (const contribution of contributions) {
                    await this.updateEmployerContribution(employee, contribution);
                }

                successCount++;
            } catch (error) {
                console.error(`Error: Failed to prefill employer contributions: ${error}\n`);
                failedCount++;
            }
        }

        console.log(`Completed! Success: ${successCount}, Failed: ${failedCount}`);
    }

    private async prefillSalary(employeeId: number): Promise<SalaryRecord[]> {
        const response = await this.apiClient.executeRequest(
            'POST',
            `/api/employees/${employeeId}/salary-records/prefill`,
            null
        );
        return response as SalaryRecord[];
    }

    private async updateSalaryRecord(employee: EmployeeMapping, record: SalaryRecord): Promise<void> {
        const annualSalary = this.getSalaryForEmployee(employee.email);

        console.log(`    Updating salary record ${record.id}: €${annualSalary.toLocaleString()}`);

        await this.apiClient.executeRequest(
            'PUT',
            `/api/salary-records/${record.id}`,
            {
                employee_id: employee.id,
                id: record.id,
                contract_history_id: null,
                start_at: record.start_at,
                end_at: record.end_at,
                taxable_income: annualSalary,
                type: record.type,
                wage_type: record.wage_type,
            }
        );
    }

    private async prefillEmployerContribution(employeeId: number): Promise<EmployerContribution[]> {
        const response = await this.apiClient.executeRequest(
            'POST',
            `/api/employees/${employeeId}/employer-contributions/prefill`,
            null
        );
        return response as EmployerContribution[];
    }

    private async updateEmployerContribution(employee: EmployeeMapping, contribution: EmployerContribution): Promise<void> {
        const annualSalary = this.getSalaryForEmployee(employee.email);
        const contributionAmount = this.calculateEmployerContribution(annualSalary);

        console.log(`   Updating contribution ${contribution.id}: €${contributionAmount.toLocaleString()}`);

        await this.apiClient.executeRequest(
            'PUT',
            `/api/employees/${employee.id}/employer-contributions/${contribution.id}`,
            {
                contribution_period: 'other',
                has_breakdown: false,
                total_contribution: contributionAmount,
                dates: {
                    from: contribution.start_date,
                    to: contribution.end_date,
                },
                id: contribution.id,
            }
        );
    }
}