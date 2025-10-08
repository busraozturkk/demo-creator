import express from 'express';
import { Server } from 'socket.io';
import { createServer } from 'http';
import path from 'path';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

// Express configuration
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../../views'));
app.use(express.static(path.join(__dirname, '../../public')));
app.use(express.json());

export { app, httpServer, io };
