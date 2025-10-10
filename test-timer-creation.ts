/**
 * Test script for timer creation functionality
 *
 * This script demonstrates how to use the TimersOperation class
 * to create timers for milestones based on project titles.
 */

import { AuthService } from './src/auth';
import { ApiClient } from './src/api-client';
import { TimersOperation } from './src/operations/time-tracking/timers';
import * as dotenv from 'dotenv';

dotenv.config();

async function testTimerCreation() {
  console.log('=== Timer Creation Test ===\n');

  // Configuration
  const LOGIN_URL = 'https://api.innoscripta.com/login';
  const TASK_MGMT_API_URL = 'https://task-management-backend.innoscripta.com';

  // Get credentials from environment
  const email = process.env.TEST_EMAIL || 'bergmann@yopmail.com';
  const password = process.env.TEST_PASSWORD || 'Test1234!';

  console.log(`Using credentials: ${email}`);

  try {
    // Step 1: Authenticate
    console.log('\n1. Authenticating...');
    const authService = new AuthService(LOGIN_URL);
    await authService.login(email, password);
    console.log('✓ Authentication successful');
    console.log(`  User ID: ${authService.getUserId()}`);

    // Step 2: Create API client
    console.log('\n2. Creating API client...');
    const apiClient = new ApiClient(authService, TASK_MGMT_API_URL);
    console.log('✓ API client created');

    // Step 3: Set partner ID (organization ID)
    const partnerId = '11980'; // From your curl example
    apiClient.setPartnerId(partnerId);
    console.log(`✓ Partner ID set: ${partnerId}`);

    // Step 4: Create main API client for PCT requests
    console.log('\n3. Creating main API client...');
    const mainApiClient = new ApiClient(authService, 'https://api.innoscripta.com');
    mainApiClient.setPartnerId(partnerId);
    console.log('✓ Main API client created');

    // Step 5: Create TimersOperation instance
    console.log('\n4. Initializing TimersOperation...');
    const timersOp = new TimersOperation(apiClient, mainApiClient);
    console.log('✓ TimersOperation initialized');

    // Step 5: Test fetching PCT tree
    console.log('\n4. Testing PCT tree fetch...');
    const projectTitle = 'KI-Assistent'; // From your curl example
    const milestones = await timersOp.fetchPctTree(projectTitle);
    console.log(`✓ Found ${milestones.length} milestones`);

    if (milestones.length === 0) {
      console.log('\n⚠ No milestones found. Test stopped.');
      return;
    }

    // Step 6: Test creating a single timer (for the first milestone)
    console.log('\n5. Testing single timer creation...');
    const firstMilestone = milestones[0];
    const userId = authService.getUserId();
    const startDate = '2025-10-06 09:00:00';
    const endDate = '2025-10-06 19:00:00';

    const success = await timersOp.createTimer(
      firstMilestone.id,
      firstMilestone.title,
      userId,
      startDate,
      endDate
    );

    if (success) {
      console.log('✓ Timer created successfully');
    } else {
      console.log('✗ Timer creation failed');
    }

    // Step 7: Test creating timers for all milestones (optional - commented out to avoid spam)
    /*
    console.log('\n6. Testing batch timer creation...');
    const mappings = await timersOp.createTimersForProject(
      projectTitle,
      userId,
      startDate,
      endDate
    );
    console.log(`✓ Created ${mappings.filter(m => m.timer_created).length}/${mappings.length} timers`);
    */

    console.log('\n=== Test Complete ===');

  } catch (error: any) {
    console.error('\n✗ Test failed:', error.message);
    if (error.stack) {
      console.error('\nStack trace:', error.stack);
    }
    process.exit(1);
  }
}

// Run the test
testTimerCreation();
