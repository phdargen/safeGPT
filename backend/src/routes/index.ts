import { Router } from 'express';
import { getAgent } from '../services/agent';

export const apiRouter = Router();

apiRouter.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});
