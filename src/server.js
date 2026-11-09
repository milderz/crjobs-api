import express from 'express';
import cors from 'cors';
import { jobsRouter } from './routes/jobs.js';
import { adminRouter } from './routes/admin.js';
import { scrapeRouter } from './routes/scrape.js';
import { startScheduler } from './scheduler.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/jobs', jobsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/scrape', scrapeRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.listen(PORT, () => {
  console.log(`crjobs-api listening on http://localhost:${PORT}`);
  startScheduler();
});
