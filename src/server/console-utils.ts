/**
 * Console override utilities for streaming logs to Socket.IO clients
 */

// Store original console methods
const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn
};

/**
 * Override console methods to emit logs to socket
 * Used for full demo creation mode
 */
export function overrideConsole(socket: any) {
    console.log = (...args: any[]) => {
        const message = args.map(arg =>
            typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');

        // Detect message patterns
        if (message.includes('Failed') || message.includes('failed') || message.includes('Error:')) {
            socket.emit('log', { type: 'error', message });
        } else if (message.includes('successfully') || message.includes('Successfully') || message.includes('Created') || message.includes('completed')) {
            socket.emit('log', { type: 'success', message });
        } else if (message.includes('Warning:') || message.includes('warning') || message.includes('Skipping')) {
            socket.emit('log', { type: 'warning', message });
        } else {
            socket.emit('log', { type: 'info', message });
        }

        originalConsole.log.apply(console, args);
    };

    console.error = (...args: any[]) => {
        const message = args.map(arg =>
            typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');

        socket.emit('log', { type: 'error', message });
        originalConsole.error.apply(console, args);
    };

    console.warn = (...args: any[]) => {
        const message = args.map(arg =>
            typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');

        socket.emit('log', { type: 'warning', message });
        originalConsole.warn.apply(console, args);
    };
}

/**
 * Override console methods for step-by-step mode
 * Emits to 'step-log' event instead of 'log'
 */
export function overrideConsoleForStep(socket: any) {
    console.log = (...args: any[]) => {
        const message = args.map(arg => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');

        // Detect message patterns for coloring
        let type = 'info';
        if (message.includes('Failed') || message.includes('failed') || message.includes('Error:') || message.includes('error')) {
            type = 'error';
        } else if (message.includes('successfully') || message.includes('Successfully') || message.includes('Created') || message.includes('completed') || message.includes('Completed')) {
            type = 'success';
        } else if (message.includes('Warning:') || message.includes('warning') || message.includes('Skipping')) {
            type = 'warning';
        }

        socket.emit('step-log', { type, message });
        originalConsole.log.apply(console, args);
    };

    console.error = (...args: any[]) => {
        const message = args.map(arg => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');

        socket.emit('step-log', { type: 'error', message });
        originalConsole.error.apply(console, args);
    };

    console.warn = (...args: any[]) => {
        const message = args.map(arg => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');

        socket.emit('step-log', { type: 'warning', message });
        originalConsole.warn.apply(console, args);
    };
}

/**
 * Restore original console methods
 */
export function restoreConsole() {
    console.log = originalConsole.log;
    console.error = originalConsole.error;
    console.warn = originalConsole.warn;
}
