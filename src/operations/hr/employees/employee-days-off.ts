import { ApiClient } from '../../../api-client';
import { DayOffTypesOperation } from '../hr-settings/day-off-types';

interface EmployeeMapping {
  email: string;
  id: number;
  first_name: string;
  last_name: string;
  started_at?: string;
}

interface DayOffRequest {
  date_from: string;
  date_to: string;
  is_half_day: boolean;
  type_id: number;
  employee_id: number;
  override: boolean;
  has_half_day_holidays: boolean;
}

export class EmployeeDaysOffOperation {
  private apiClient: ApiClient;
  private dayOffTypesOp: DayOffTypesOperation;

  constructor(apiClient: ApiClient, dayOffTypesOp: DayOffTypesOperation) {
    this.apiClient = apiClient;
    this.dayOffTypesOp = dayOffTypesOp;
  }

  async createDaysOff(employeeMappings: EmployeeMapping[]): Promise<void> {
    console.log(`Starting days-off creation for ${employeeMappings.length} employees\n`);

    const vacationTypes = this.dayOffTypesOp.getVacationTypes();
    const sickDayTypes = this.dayOffTypesOp.getSickDayTypes();

    if (vacationTypes.length === 0) {
      console.error('No vacation types found in cache. Please run day-off types fetch first.');
      return;
    }

    let successCount = 0;
    let failedCount = 0;
    let totalDaysCreated = 0;

    for (let i = 0; i < employeeMappings.length; i++) {
      const employee = employeeMappings[i];
      console.log(`[${i + 1}/${employeeMappings.length}] Creating days-off for: ${employee.first_name} ${employee.last_name} (ID: ${employee.id})`);

      try {
        const daysCreated = await this.createRandomDaysOffForEmployee(
          employee,
          vacationTypes,
          sickDayTypes
        );
        if (daysCreated > 0) {
          console.log(`Created ${daysCreated} day(s) off\n`);
        } else {
          console.log(`All days-off already exist (skipped)\n`);
        }

        totalDaysCreated += daysCreated;
        successCount++;
      } catch (error) {
        console.error(`Error: Failed to create days-off: ${error}\n`);
        failedCount++;
      }
    }

    console.log(`Completed! Success: ${successCount}, Failed: ${failedCount}`);
    console.log(`Total days-off created: ${totalDaysCreated}`);
  }

  private async createRandomDaysOffForEmployee(
    employee: EmployeeMapping,
    vacationTypes: any[],
    sickDayTypes: any[]
  ): Promise<number> {
    const daysOff: DayOffRequest[] = [];
    const usedDates = new Set<string>(); // Track used dates to avoid duplicates
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Add some randomness based on employee ID to ensure different dates for each employee
    const employeeSeed = employee.id % 1000;

    // Calculate the start of current week (Monday)
    const currentWeekStart = new Date(today);
    const dayOfWeek = today.getDay();
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // If Sunday (0), go back 6 days, else go back to Monday
    currentWeekStart.setDate(today.getDate() - daysToMonday);
    currentWeekStart.setHours(0, 0, 0, 0);

    // Calculate valid date range for this employee
    // Start from contract start date or beginning of current year (whichever is later)
    const contractStartDate = employee.started_at
      ? new Date(employee.started_at)
      : new Date(today.getFullYear(), 0, 1);

    const validStartDate = contractStartDate > new Date(today.getFullYear(), 0, 1)
      ? contractStartDate
      : new Date(today.getFullYear(), 0, 1);

    // End date is the day before current week starts (exclude current week)
    const validEndDate = new Date(currentWeekStart);
    validEndDate.setDate(currentWeekStart.getDate() - 1);

    // If contract started in the future or no valid date range, skip this employee
    if (validStartDate > validEndDate) {
      console.log(`  Skipping: contract starts in the future or no valid dates before current week`);
      return 0;
    }

    // Track total vacation days used (max 24)
    let totalVacationDays = 0;
    const maxVacationDays = 24;

    // Only use "Vacation" type - find it from vacationTypes
    const vacationType = vacationTypes.find(type => type.name === 'Vacation');
    if (!vacationType) {
      console.log(`  Skipping: "Vacation" type not found`);
      return 0;
    }

    // Generate 8-12 vacation periods (more varied)
    const vacationPeriods = this.randomInt(8, 12, employeeSeed);
    let attempts = 0;
    const maxAttempts = vacationPeriods * 3; // Allow some retries

    for (let i = 0; i < vacationPeriods && totalVacationDays < maxVacationDays && attempts < maxAttempts; attempts++) {
      // Random vacation length: 1-5 days (shorter periods for more entries)
      const daysLength = Math.min(
        this.randomInt(1, 5, employeeSeed + attempts),
        maxVacationDays - totalVacationDays
      );

      // Random start date between contract start and valid end date (before current week)
      const startDate = this.randomDate(validStartDate, validEndDate, employeeSeed + i);
      const startDateStr = this.formatDate(startDate);

      // Check if this date range overlaps with existing dates
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + daysLength - 1);

      let hasOverlap = false;
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        if (usedDates.has(this.formatDate(d))) {
          hasOverlap = true;
          break;
        }
      }

      if (hasOverlap) continue; // Skip this iteration and try another date

      // Mark dates as used
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        usedDates.add(this.formatDate(d));
      }

      // Only add "Vacation" type days-off
      daysOff.push({
        date_from: startDateStr,
        date_to: this.formatDate(endDate),
        is_half_day: false,
        type_id: vacationType.id,
        employee_id: employee.id,
        override: false,
        has_half_day_holidays: false,
      });

      totalVacationDays += daysLength;
      i++; // Only increment if we successfully added
    }

    // Create all days-off (skip if already exists)
    let createdCount = 0;
    let skippedCount = 0;
    for (const dayOff of daysOff) {
      try {
        await this.createDayOff(dayOff);
        createdCount++;
      } catch (error: any) {
        // If the error is about duplicate dates, skip silently
        if (error.message && error.message.includes('already')) {
          // Skip silently - this is expected on re-runs or if dates overlap
          console.log(`    Skipped: ${dayOff.date_from} to ${dayOff.date_to} (already exists)`);
          skippedCount++;
          continue;
        }
        // For other errors, still throw
        throw error;
      }
    }

    if (skippedCount > 0) {
      console.log(`  Note: ${skippedCount} day(s) were skipped (already exist)`);
    }

    return createdCount;
  }

  private async createDayOff(dayOff: DayOffRequest): Promise<void> {
    try {
      await this.apiClient.executeRequest('POST', '/api/days-off', dayOff);
    } catch (error: any) {
      // Log the detailed error and request payload for debugging 422 errors
      console.error(`    Failed to create day-off: ${error.message}`);
      console.error(`    Request payload: ${JSON.stringify(dayOff, null, 2)}`);
      throw error;
    }
  }

  private randomInt(min: number, max: number, seed?: number): number {
    let random = Math.random();
    if (seed !== undefined) {
      // Mix seed into randomness
      random = (random + (seed * 0.001)) % 1;
    }
    return Math.floor(random * (max - min + 1)) + min;
  }

  private randomDate(start: Date, end: Date, employeeSeed?: number): Date {
    const startTime = start.getTime();
    const endTime = end.getTime();

    // Add employee seed to randomness to ensure different dates for different employees
    let random = Math.random();
    if (employeeSeed !== undefined) {
      // Mix employee seed into randomness
      random = (random + (employeeSeed * 0.001)) % 1;
    }

    const randomTime = startTime + random * (endTime - startTime);
    return new Date(randomTime);
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}