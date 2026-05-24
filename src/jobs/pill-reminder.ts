import type { Job, JobResult } from '../types.js';

export const pillReminder: Job = {
  id: 'pill-reminder',
  description: 'Daily 8pm pill reminder',
  schedule: '0 20 * * *',
  timezone: 'Asia/Taipei',
  enabled: true,

  execute(): Promise<JobResult> {
    return Promise.resolve({ content: '💊 Time to take your pill!' });
  },
};
