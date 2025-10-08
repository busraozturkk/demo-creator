import { AuthService } from './src/auth';
import { ApiClient } from './src/api-client';
import { EmployeesOperation } from './src/operations/employees';
import * as fs from 'fs';

async function updateParticipateInProjects() {
  console.log('Updating participate_in_projects for all employees\n');

  // Load environment variables
  const email = process.env.PROD_EMAIL || '';
  const password = process.env.PROD_PASSWORD || '';
  const hrApiBaseUrl = process.env.PROD_HR_API_BASE_URL || 'https://innos-hr-backend.innoscripta.com';
  const loginUrl = process.env.PROD_LOGIN_URL || 'https://api.innoscripta.com/auth/login';

  try {
    // Login
    console.log('Logging in...');
    const authService = new AuthService(loginUrl);
    const token = await authService.login(email, password);
    console.log('Successfully authenticated!\n');

    // Create HR API client
    const hrApiClient = new ApiClient(authService, hrApiBaseUrl);

    // Load employee mappings from cache
    const cachePath = './data/cache/employee-mappings.json';
    if (!fs.existsSync(cachePath)) {
      console.error('Employee mappings cache not found. Please run the main script first.');
      process.exit(1);
    }

    const employeeMappings = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    console.log(`Found ${employeeMappings.length} employees in cache\n`);

    let updated = 0;
    let errors = 0;

    for (let i = 0; i < employeeMappings.length; i++) {
      const employee = employeeMappings[i];
      const employeeName = `${employee.first_name} ${employee.last_name}`;

      try {
        console.log(`[${i + 1}/${employeeMappings.length}] Updating: ${employeeName} (ID: ${employee.id})`);

        await hrApiClient.executeRequest(
          'PUT',
          `/api/employees/${employee.id}`,
          {
            participate_in_projects: true
          }
        );

        console.log(`  ✓ Updated\n`);
        updated++;
      } catch (error: any) {
        console.error(`  ✗ Failed: ${error.message}\n`);
        errors++;
      }
    }

    console.log(`\nCompleted!`);
    console.log(`  - Updated: ${updated}`);
    console.log(`  - Errors: ${errors}`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

updateParticipateInProjects();
