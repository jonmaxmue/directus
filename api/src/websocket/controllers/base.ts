import { Accountability } from '@directus/shared/types';
import { IncomingMessage, Server as httpServer } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { parse } from 'url';
import { SocketControllerConfig, WebRequest } from '../../services/websocket/types';
import logger from '../../logger';
import { getAccountabilityForToken } from '../../utils/get-accountability-for-token';
import internal from 'stream';

export const defaultSocketConfig: SocketControllerConfig = {
	endpoint: '/websocket',
	public: false,
};

export function extractToken(req: any, query: any): string | null {
	if (query && query.access_token) {
		return query.access_token as string;
	}

	let token: string | null = null;
	if (req.headers && req.headers.authorization) {
		const parts = req.headers.authorization.split(' ');

		if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
			token = parts[1];
		}
	}
	return token;
}

export default abstract class SocketController {
	config: SocketControllerConfig;
	server: WebSocket.Server;
	// hook the websocket handler into the express server
	constructor(httpServer: httpServer, config?: SocketControllerConfig) {
		this.server = new WebSocketServer({ noServer: true });
		this.config = config ?? defaultSocketConfig;

		httpServer.on('upgrade', this.handleUpgrade.bind(this));
	}
	private async handleUpgrade(request: IncomingMessage, socket: internal.Duplex, head: Buffer) {
		const { pathname, query } = parse(request.url!, true);
		if (pathname === this.config.endpoint) {
			const req = request as WebRequest;
			logger.info('test ' + this.constructor.name + ' - ' + JSON.stringify(this.config));
			if (!this.config.public) {
				let accountability: Accountability | undefined;
				// check token before upgrading when not set to public access
				try {
					accountability = await getAccountabilityForToken(extractToken(request, query));
				} catch (err: any) {
					accountability = undefined;
				}
				if (!accountability || !accountability.user /* || !accountability.role*/) {
					// do we need to check the role?
					logger.debug('Websocket upgrade denied - ' + JSON.stringify(accountability || 'invalid'));
					socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
					socket.destroy();
					return;
				}
				req.accountability = accountability;
			}
			this.server.handleUpgrade(request, socket, head, (ws) => {
				this.server.emit('connection', ws, req);
			});
		}
	}
	terminate() {
		this.server.clients.forEach((ws) => {
			ws.terminate();
		});
	}
}
