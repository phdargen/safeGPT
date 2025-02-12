import { Server, Socket } from 'socket.io';
import { HumanMessage } from "@langchain/core/messages";
import { getAgent } from '../services/agent';

export function setupWebSocket(io: Server) {
  io.on('connection', async (socket: Socket) => {

    console.log('Client connected');

    // Add a simple echo test
    socket.on('test', (msg) => {
      console.log('Received test message:', msg);
      socket.emit('test-response', 'Server received: ' + msg);
    });

    socket.on('chat-message', async (message: string) => {
      console.log('Received chat message:', message);
      try {
        let agentResponse = '';
        let toolResponse = null;
        
        const { agent, config } = getAgent();
        const stream = await agent.stream(
          { messages: [new HumanMessage(message)] },
          config
        );

        for await (const chunk of stream) {
          if ("agent" in chunk) {
            console.log("agent-response:", chunk.agent.messages[0].content);
            // Wait for non-empty agent response
            if (chunk.agent.messages[0].content.trim() !== "") {
              //console.log("agent-response:", chunk.agent);
              agentResponse = chunk.agent.messages[0].content;
              socket.emit('agent-response', agentResponse);
            }
          } else if ("tools" in chunk) {
            console.log("tool-response:", chunk.tools.messages[0].content);
            toolResponse = chunk.tools.messages[0].content;
          }
        }

        if(toolResponse)socket.emit('tool-response', toolResponse);

      } catch (error) {
        console.error('Error processing message:', error);
        socket.emit('error', 'Error processing your message');
      }
    });

    socket.on('silent-request', async (message: string) => {
      console.log('Received silent request:', message); // Add logging
      try {
        const { agent, config } = getAgent();
        const stream = await agent.stream(
          { messages: [new HumanMessage(message)] },
          config
        );

        for await (const chunk of stream) {
          if ("tools" in chunk) {
            console.log("tool-response:", chunk.tools.messages[0].content);
            socket.emit('tool-response', chunk.tools.messages[0].content);
          }
          // Ignore agent responses for silent requests
        }
      } catch (error) {
        console.error('Error processing silent request:', error);
      }
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected');
    });
  });
} 