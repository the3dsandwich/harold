import type { Job, JobResult } from '../types.js';

export const pillReminder: Job = {
  id: 'pill-reminder',
  description: 'Daily 5pm pill reminder',
  schedule: '0 17 * * *',
  timezone: 'Asia/Taipei',
  enabled: true,

  async execute(): Promise<JobResult> {
    return { content: '💊 Time to take your pill!' };
  },
};
