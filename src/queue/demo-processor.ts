import { Job } from 'bull';
import { demoQueue, DemoJobData, DemoJobProgress } from './demo-queue';
import { io } from '../server/app';

/**
 * Process demo creation jobs
 * This processor runs independently and survives server restarts
 * Concurrency: 5 jobs can run in parallel
 */
demoQueue.process(5, async (job: Job<DemoJobData>) => {
  const { dataGroup, emailDomain, environment, mode, socketId } = job.data;

  console.log(`\n[Queue] Processing job ${job.id} for ${dataGroup} in ${environment} mode`);
  console.log(`[Queue] Mode: ${mode}, Socket: ${socketId || 'none'}`);

  try {
    // Get socket for real-time updates (if available)
    const socket = socketId ? io.sockets.sockets.get(socketId) : null;

    if (mode === 'bulk') {
      // Bulk mode - run all steps automatically
      const { runDemoCreation } = await import('../core/demo-creator');

      // Create a progress reporter
      const progressReporter = (step: string, current: number, total: number, message: string) => {
        const percentage = Math.round((current / total) * 100);
        const progress: DemoJobProgress = {
          step,
          currentStep: current,
          totalSteps: total,
          percentage,
          message,
        };

        // Update job progress
        job.progress(progress);

        // Send to socket if connected (with job ID for multi-job tracking)
        if (socket) {
          socket.emit('log', { type: 'info', message, jobId: job.id });
          socket.emit(`log-${job.id}`, { type: 'info', message });
        }
      };

      // Run demo creation with progress reporting
      await runDemoCreation(
        socket,
        dataGroup,
        emailDomain,
        job.data.email || '',
        job.data.password || '',
        environment,
        job.data.companyName || '',
        job.data.selectedProjects || [],
        job.data.includeWorkPackages !== false,
        job.data.projectType,
        job.id  // Pass job ID for logging
      );

    } else {
      // Step-by-step mode - individual steps are run via separate API calls
      // This mode doesn't use the queue, steps are run synchronously
      throw new Error('Step-by-step mode should not be queued');
    }

    console.log(`[Queue] Job ${job.id} completed successfully`);

    // Notify via socket
    if (socket) {
      socket.emit('demo-complete', { success: true });
    }

    return { success: true, completedAt: new Date().toISOString() };

  } catch (error: any) {
    console.error(`[Queue] Job ${job.id} failed:`, error.message);

    // Notify via socket
    const socket = socketId ? io.sockets.sockets.get(socketId) : null;
    if (socket) {
      socket.emit('log', { type: 'error', message: `Job failed: ${error.message}` });
      socket.emit('demo-complete', { success: false, error: error.message });
    }

    throw error; // Re-throw to mark job as failed
  }
});

// Event handlers for monitoring
demoQueue.on('completed', (job, result) => {
  console.log(`[Queue] Job ${job.id} completed:`, result);
});

demoQueue.on('failed', (job, err) => {
  console.error(`[Queue] Job ${job?.id} failed:`, err.message);
});

demoQueue.on('progress', (job, progress: DemoJobProgress) => {
  console.log(`[Queue] Job ${job.id} progress: ${progress.percentage}% - ${progress.message}`);
});

export default demoQueue;
