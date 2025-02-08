import { Router } from 'express';
import { getAgent } from '../services/agent';

export const apiRouter = Router();

apiRouter.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

apiRouter.get('/wallet', async (req, res) => {
  try {
    const { agent, config } = getAgent();
    // Add wallet info endpoint implementation
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get wallet info' });
  }
}); 