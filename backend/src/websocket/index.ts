import { Server, Socket } from 'socket.io';
import { HumanMessage } from "@langchain/core/messages";
import { getAgent } from '../services/agent';

export function setupWebSocket(io: Server) {
  io.on('connection', (socket: Socket) => {
    console.log('Client connected');

    // Add a simple echo test
    socket.on('test', (msg) => {
      console.log('Received test message:', msg);
      socket.emit('test-response', 'Server received: ' + msg);
    });

    socket.on('chat-message', async (message: string) => {
      console.log('Received chat message:', message); // Add logging
      try {
        const { agent, config } = getAgent();
        const stream = await agent.stream(
          { messages: [new HumanMessage(message)] },
          config
        );

        for await (const chunk of stream) {
          if ("agent" in chunk) {
            socket.emit('agent-response', chunk.agent.messages[0].content);
          } else if ("tools" in chunk) {
            socket.emit('tool-response', chunk.tools.messages[0].content);
          }
        }
      } catch (error) {
        console.error('Error processing message:', error);
        socket.emit('error', 'Error processing your message');
      }
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected');
    });
  });
} 