/**
 * Quick test script for milestone assignment functionality
 */
import { config } from 'dotenv';
import { AuthService } from './src/auth';
import { ApiClient } from './src/api-client';
import { MilestonesOperation } from './src/operations/project-management/milestones';
import * as fs from 'fs';

config();

async function testMilestoneAssignment() {
  console.log('=== Testing Milestone Assignment ===\n');

  // Check if we have cached data from a previous run
  const milestoneMappingsPath = './data/cache/milestone-mappings.json';
  const employeeMappingsPath = './data/cache/employee-mappings.json';
  const taskYearPmPath = './data/cache/task-year-pm-assignments.json';

  if (!fs.existsSync(milestoneMappingsPath)) {
    console.log('❌ No milestone mappings found. Please run a full demo creation first.');
    return;
  }

  if (!fs.existsSync(employeeMappingsPath)) {
    console.log('❌ No employee mappings found. Please run a full demo creation first.');
    return;
  }

  if (!fs.existsSync(taskYearPmPath)) {
    console.log('❌ No task-year-pm assignments found. Please run a full demo creation first.');
    return;
  }

  const milestoneMappings = JSON.parse(fs.readFileSync(milestoneMappingsPath, 'utf-8'));
  const employeeMappings = JSON.parse(fs.readFileSync(employeeMappingsPath, 'utf-8'));

  console.log(`✓ Found ${milestoneMappings.length} milestones`);
  console.log(`✓ Found ${employeeMappings.length} employees\n`);

  // Get organization ID from cache
  const organizationCachePath = './data/cache/organization-id.json';
  if (!fs.existsSync(organizationCachePath)) {
    console.log('❌ No organization cache found. Please run a full demo creation first.');
    return;
  }

  const { organization_id: organizationId } = JSON.parse(fs.readFileSync(organizationCachePath, 'utf-8'));

  // Get owner user ID (first employee with participate_in_projects=true or first employee)
  const ownerEmployee = employeeMappings.find((emp: any) => emp.participate_in_projects === true) || employeeMappings[0];
  const ownerUserId = ownerEmployee?.user_id;

  console.log(`✓ Organization ID: ${organizationId}`);
  console.log(`✓ Owner: ${ownerEmployee?.first_name} ${ownerEmployee?.last_name} (User ID: ${ownerUserId})\n`);

  // Initialize auth and API client
  const environment = 'testing';
  const authService = new AuthService(environment);

  // Get credentials from .env
  const email = process.env.TESTING_EMAIL;
  const password = process.env.TESTING_PASSWORD;

  if (!email || !password) {
    console.log('❌ TESTING_EMAIL and TESTING_PASSWORD must be set in .env');
    return;
  }

  console.log('Logging in...');
  await authService.login(email, password);
  console.log('✓ Logged in successfully\n');

  const apiClient = new ApiClient(authService, environment);

  // Test milestone assignment
  const milestonesOp = new MilestonesOperation(apiClient);

  console.log('Testing milestone employee assignment...\n');

  try {
    await milestonesOp.assignEmployeesToMilestones(
      milestoneMappings,
      organizationId,
      ownerUserId
    );
    console.log('\n✅ Milestone assignment test completed successfully!');
  } catch (error: any) {
    console.error('\n❌ Milestone assignment test failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

testMilestoneAssignment().catch(console.error);
