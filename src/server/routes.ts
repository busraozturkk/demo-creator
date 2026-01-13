import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { io } from './app';

const router = Router();

// Session storage for step-by-step mode
export const sessions = new Map();

/**
 * Home page - render form with data groups
 */
router.get('/', (req, res) => {
    const dataDir = path.join(__dirname, '../../data');
    const dataDirs = fs.readdirSync(dataDir)
        .filter(file => fs.statSync(path.join(dataDir, file)).isDirectory())
        .filter(dir => !dir.startsWith('.') && dir !== 'avatars' && dir !== 'cache');

    // Map directory names to display labels with grouping
    const dataMapping: { [key: string]: { label: string; group: string } } = {
        'manufacturing-en': { label: 'Manufacturing & Product Development', group: 'English' },
        'healthcare-en': { label: 'Healthcare & Pharmaceuticals', group: 'English' },
        'financial-en': { label: 'Financial Services', group: 'English' },
        'consulting-en': { label: 'Services & Consulting', group: 'English' },
        'energy-en': { label: 'Energy & Utilities', group: 'English' },
        'government-en': { label: 'Government & Public Sector', group: 'English' },
        'construction-en': { label: 'Construction & Infrastructure', group: 'English' },
        'media-en': { label: 'Media & Telecommunications', group: 'English' },
        'manufacturing-de': { label: 'Fertigung & Produktentwicklung', group: 'Deutsch' },
        'healthcare-de': { label: 'Gesundheitswesen & Pharmazeutika', group: 'Deutsch' },
        'financial-de': { label: 'Finanzdienstleistungen', group: 'Deutsch' },
        'consulting-de': { label: 'Dienstleistungen & Beratung', group: 'Deutsch' },
        'energy-de': { label: 'Energie & Versorgung', group: 'Deutsch' },
        'government-de': { label: 'Verwaltung & Öffentlicher Sektor', group: 'Deutsch' },
        'construction-de': { label: 'Bau & Infrastruktur', group: 'Deutsch' },
        'media-de': { label: 'Medien & Telekommunikation', group: 'Deutsch' },
    };

    // Group data by language
    const groupedData: { [key: string]: Array<{ value: string; label: string }> } = {};
    dataDirs.forEach(dir => {
        if (dataMapping[dir]) {
            const { label, group } = dataMapping[dir];
            if (!groupedData[group]) {
                groupedData[group] = [];
            }
            groupedData[group].push({ value: dir, label });
        }
    });

    res.render('index', { groupedData, hasGroups: Object.keys(groupedData).length > 0 });
});

/**
 * Fetch projects based on data group and optional project type
 */
router.get('/api/projects/:dataGroup', (req, res) => {
    const { dataGroup } = req.params;
    const { projectType } = req.query;
    const projectsPath = path.join(__dirname, '../../data', dataGroup, 'projects.csv');

    if (!fs.existsSync(projectsPath)) {
        return res.status(404).json({ error: 'Projects file not found' });
    }

    try {
        const { parse } = require('csv-parse/sync');
        const fileContent = fs.readFileSync(projectsPath, 'utf-8');
        const records = parse(fileContent, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
        });

        let projects = records.map((record: any) => ({
            short_title: record.short_title,
            title: record.title,
            type_id: record.type_id,
            started_at: record.started_at,
            finished_at: record.finished_at,
        }));

        // Filter by project type if provided
        if (projectType) {
            const typeId = parseInt(projectType as string);
            projects = projects.filter((p: any) => parseInt(p.type_id) === typeId);
        }

        res.json({ projects });
    } catch (error) {
        res.status(500).json({ error: 'Failed to load projects' });
    }
});

/**
 * Create demo account (full automation)
 * Now uses Bull queue for reliable job processing
 */
router.post('/api/create-demo', async (req, res) => {
    const { dataGroup, emailDomain, email, password, environment, companyName, childCompanies, selectedProjects, includeWorkPackages, projectType } = req.body;
    const socketId = req.body.socketId;

    const socket = io.sockets.sockets.get(socketId);

    if (!socket) {
        return res.status(400).json({ error: 'Socket connection not found' });
    }

    try {
        // Add job to queue
        const { demoQueue } = await import('../queue/demo-queue');
        const job = await demoQueue.add({
            dataGroup,
            emailDomain,
            email,
            password,
            environment: environment || 'testing',
            companyName,
            childCompanies: childCompanies || [],
            selectedProjects: selectedProjects || [],
            includeWorkPackages: includeWorkPackages !== false,
            projectType: projectType ? parseInt(projectType) : undefined,
            mode: 'bulk',
            socketId,
        });

        console.log(`[API] Queued demo creation job ${job.id}`);

        res.json({
            success: true,
            message: 'Demo creation queued',
            jobId: job.id
        });
    } catch (error: any) {
        console.error('[API] Failed to queue job:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Run a single step in step-by-step mode
 * This endpoint will be implemented to use the StepRunner class
 */
router.post('/api/run-step', async (req, res) => {
    const { stepId, sessionData, socketId } = req.body;

    const socket = io.sockets.sockets.get(socketId);

    try {
        // Import step runner
        const { runSingleStep } = await import('../core/step-runner');
        const { overrideConsoleForStep, restoreConsole } = await import('./console-utils');

        let session = sessions.get(socketId) || {};

        // Merge session data
        if (sessionData.email) session.email = sessionData.email;
        if (sessionData.password) session.password = sessionData.password;
        if (sessionData.dataGroup) session.dataGroup = sessionData.dataGroup;
        if (sessionData.emailDomain) session.emailDomain = sessionData.emailDomain;
        if (sessionData.environment) session.environment = sessionData.environment;
        if (sessionData.companyName) session.companyName = sessionData.companyName;
        if (sessionData.selectedProjects !== undefined) session.selectedProjects = sessionData.selectedProjects;
        if (sessionData.includeWorkPackages !== undefined) session.includeWorkPackages = sessionData.includeWorkPackages;
        if (sessionData.projectType !== undefined) session.projectType = parseInt(sessionData.projectType);

        // Override console for this step
        if (socket) {
            overrideConsoleForStep(socket);
        }

        // Run the specific step
        await runSingleStep(stepId, session);

        // Restore console
        restoreConsole();

        // Save session (but don't send non-serializable objects to client)
        sessions.set(socketId, session);

        // Send only serializable data back to client
        const clientSession = {
            email: session.email,
            password: session.password,
            dataGroup: session.dataGroup,
            emailDomain: session.emailDomain,
            environment: session.environment,
            organizationId: session.organizationId,
            companyName: session.companyName,
            companyId: session.companyId
        };

        res.json({ success: true, sessionData: clientSession });
    } catch (error: any) {
        const { restoreConsole } = await import('./console-utils');
        restoreConsole();
        console.error(`Step ${stepId} failed:`, error);
        if (socket) {
            socket.emit('step-log', { type: 'error', message: `Error: ${error.message}` });
        }
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Get job status and progress
 */
router.get('/api/job/:jobId', async (req, res) => {
    try {
        const { demoQueue } = await import('../queue/demo-queue');
        const job = await demoQueue.getJob(req.params.jobId);

        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
        }

        const state = await job.getState();
        const progress = job.progress();
        const result = job.returnvalue;
        const failedReason = job.failedReason;

        res.json({
            id: job.id,
            state,
            progress,
            result,
            failedReason,
            data: job.data,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Get all jobs (for monitoring/debugging)
 */
router.get('/api/jobs', async (req, res) => {
    try {
        const { demoQueue } = await import('../queue/demo-queue');
        const jobs = await demoQueue.getJobs(['waiting', 'active', 'completed', 'failed']);

        const jobsInfo = await Promise.all(
            jobs.map(async (job) => {
                const state = await job.getState();
                const progress = job.progress();
                return {
                    id: job.id,
                    state,
                    progress: typeof progress === 'object' ? progress : { percentage: 0, message: '' },
                    data: {
                        dataGroup: job.data.dataGroup,
                        companyName: job.data.companyName,
                        email: job.data.email,
                        environment: job.data.environment,
                    },
                    timestamp: job.timestamp,
                    finishedOn: job.finishedOn,
                    failedReason: job.failedReason,
                };
            })
        );

        res.json({ jobs: jobsInfo });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Stop/cancel a running job
 */
router.post('/api/job/:jobId/stop', async (req, res) => {
    try {
        const { demoQueue } = await import('../queue/demo-queue');
        const job = await demoQueue.getJob(req.params.jobId);

        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
        }

        const state = await job.getState();

        if (state === 'completed' || state === 'failed') {
            return res.json({ success: false, error: 'Job already finished' });
        }

        if (state === 'active') {
            // For active jobs, mark as failed (this will stop the job)
            await job.moveToFailed({ message: 'Cancelled by user' }, true);
            console.log(`[API] Active job ${job.id} cancelled by user`);
        } else {
            // For waiting jobs, just remove from queue
            await job.remove();
            console.log(`[API] Waiting job ${job.id} removed by user`);
        }

        res.json({ success: true, message: 'Job stopped successfully' });
    } catch (error: any) {
        console.error('[API] Failed to stop job:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Remove/delete a job from the queue (for completed/failed jobs)
 */
router.delete('/api/job/:jobId', async (req, res) => {
    try {
        const { demoQueue } = await import('../queue/demo-queue');
        const job = await demoQueue.getJob(req.params.jobId);

        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
        }

        const state = await job.getState();

        // Only allow removal of completed, failed, or waiting jobs
        // Active jobs cannot be removed (Bull limitation)
        if (state === 'active') {
            return res.status(400).json({
                error: 'Cannot delete active job. Please cancel it first.'
            });
        }

        // Remove the job from queue
        await job.remove();

        console.log(`[API] Job ${job.id} (${state}) removed from queue`);

        res.json({ success: true, message: 'Job removed successfully' });
    } catch (error: any) {
        console.error('[API] Failed to remove job:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Version endpoint for client-side update checking
 */
router.get('/api/version', (req, res) => {
    // Use deployment timestamp as version identifier
    const version = process.env.DEPLOY_TIME || Date.now().toString();
    res.json({ version });
});

export default router;
