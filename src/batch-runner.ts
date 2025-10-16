#!/usr/bin/env node

/**
 * Batch Runner - Run multiple demo creations sequentially
 *
 * Usage: npm run batch
 * or: ts-node src/batch-runner.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { DemoCreator } from './core/demo-creator';

interface BatchConfig {
    name: string;
    email: string;
    password: string;
    organizationName: string;
    language: 'en' | 'de';
    csvPath?: string;
    selectedSteps?: string[];
}

async function runBatch() {
    console.log('\n==========================================================');
    console.log('           BATCH DEMO CREATOR                             ');
    console.log('==========================================================\n');

    // Load batch configuration
    const configPath = path.join(process.cwd(), 'batch-config.json');

    if (!fs.existsSync(configPath)) {
        console.error(`ERROR: batch-config.json not found at ${configPath}`);
        console.error('Please create a batch-config.json file with your demo configurations.');
        process.exit(1);
    }

    const configs: BatchConfig[] = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    console.log(`Loaded ${configs.length} demo configurations from batch-config.json\n`);

    let successCount = 0;
    let failureCount = 0;
    const results: Array<{ name: string; status: 'success' | 'failed'; error?: string; duration?: number }> = [];

    // Run each demo creation sequentially
    for (let i = 0; i < configs.length; i++) {
        const config = configs[i];
        const startTime = Date.now();

        console.log('\n----------------------------------------------------------');
        console.log(`[${i + 1}/${configs.length}] Starting: ${config.name}`);
        console.log('----------------------------------------------------------');
        console.log(`Email: ${config.email}`);
        console.log(`Organization: ${config.organizationName}`);
        console.log(`Language: ${config.language}`);
        console.log(`CSV Path: ${config.csvPath || 'default'}`);
        console.log('----------------------------------------------------------\n');

        try {
            const demoCreator = new DemoCreator();

            // Set up progress logging
            demoCreator.on('progress', (data) => {
                console.log(`[${config.name}] ${data.step}: ${data.message}`);
            });

            demoCreator.on('error', (data) => {
                console.error(`[${config.name}] ERROR in ${data.step}: ${data.message}`);
            });

            // Run the demo creation
            await demoCreator.createDemo({
                email: config.email,
                password: config.password,
                organizationName: config.organizationName,
                language: config.language,
                csvPath: config.csvPath,
                selectedSteps: config.selectedSteps || undefined
            });

            const duration = Date.now() - startTime;
            const durationMinutes = Math.floor(duration / 60000);
            const durationSeconds = Math.floor((duration % 60000) / 1000);

            console.log('\n----------------------------------------------------------');
            console.log(`[${i + 1}/${configs.length}] ✓ SUCCESS: ${config.name}`);
            console.log(`Duration: ${durationMinutes}m ${durationSeconds}s`);
            console.log('----------------------------------------------------------\n');

            successCount++;
            results.push({
                name: config.name,
                status: 'success',
                duration
            });

        } catch (error: any) {
            const duration = Date.now() - startTime;
            const durationMinutes = Math.floor(duration / 60000);
            const durationSeconds = Math.floor((duration % 60000) / 1000);

            console.error('\n----------------------------------------------------------');
            console.error(`[${i + 1}/${configs.length}] ✗ FAILED: ${config.name}`);
            console.error(`Error: ${error.message}`);
            console.error(`Duration: ${durationMinutes}m ${durationSeconds}s`);
            console.error('----------------------------------------------------------\n');

            failureCount++;
            results.push({
                name: config.name,
                status: 'failed',
                error: error.message,
                duration
            });
        }

        // Add a small delay between demos to let systems stabilize
        if (i < configs.length - 1) {
            console.log('Waiting 5 seconds before starting next demo...\n');
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }

    // Print summary
    console.log('\n==========================================================');
    console.log('           BATCH EXECUTION SUMMARY                        ');
    console.log('==========================================================\n');
    console.log(`Total demos: ${configs.length}`);
    console.log(`✓ Successful: ${successCount}`);
    console.log(`✗ Failed: ${failureCount}`);
    console.log('\nDetailed Results:\n');

    results.forEach((result, index) => {
        const durationMinutes = Math.floor((result.duration || 0) / 60000);
        const durationSeconds = Math.floor(((result.duration || 0) % 60000) / 1000);

        if (result.status === 'success') {
            console.log(`  ${index + 1}. ✓ ${result.name} (${durationMinutes}m ${durationSeconds}s)`);
        } else {
            console.log(`  ${index + 1}. ✗ ${result.name} (${durationMinutes}m ${durationSeconds}s)`);
            console.log(`     Error: ${result.error}`);
        }
    });

    console.log('\n==========================================================\n');

    // Save results to file
    const resultsPath = path.join(process.cwd(), 'batch-results.json');
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    console.log(`Results saved to: ${resultsPath}\n`);

    // Exit with appropriate code
    process.exit(failureCount > 0 ? 1 : 0);
}

// Run the batch
runBatch().catch(error => {
    console.error('FATAL ERROR in batch runner:', error);
    process.exit(1);
});
