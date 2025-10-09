/**
 * UI Server - Web interface for creating demo accounts
 *
 * This server provides a web UI on port 3000 for creating demo accounts
 * with full or step-by-step execution modes.
 */

import { app, httpServer, io } from './server/app';
import routes, { sessions } from './server/routes';

// Initialize queue processor
import './queue/demo-processor';

// Register routes
app.use(routes);

// Track active demo creation sessions
let activeDemoSessions = 0;

// Socket.IO connection handler
io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id} [Total active sessions: ${sessions.size}]`);

    socket.on('demo-started', () => {
        activeDemoSessions++;
        console.log(`Demo creation started [Active demos: ${activeDemoSessions}]`);
    });

    socket.on('demo-completed', () => {
        activeDemoSessions = Math.max(0, activeDemoSessions - 1);
        console.log(`Demo creation completed [Active demos: ${activeDemoSessions}]`);
    });

    socket.on('disconnect', () => {
        // Clean up session data for this socket
        if (sessions.has(socket.id)) {
            sessions.delete(socket.id);
            console.log(`Session cleaned up for: ${socket.id}`);
        }
        console.log(`Client disconnected: ${socket.id} [Remaining sessions: ${sessions.size}]`);
    });
});

// Expose active sessions count for monitoring
export function getActiveDemoSessions(): number {
    return activeDemoSessions;
}

// Start server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`UI Server running on http://localhost:${PORT}`);
    console.log('Ready to create demo accounts');
});
