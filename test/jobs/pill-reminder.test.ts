import { describe, it, expect } from 'vitest';
import { pillReminder } from '../../src/jobs/pill-reminder.js';

describe('pillReminder job', () => {
  it('has correct static metadata', () => {
    expect(pillReminder.id).toBe('pill-reminder');
    expect(pillReminder.schedule).toBe('0 17 * * *');
    expect(pillReminder.timezone).toBe('Asia/Taipei');
    expect(pillReminder.enabled).toBe(true);
  });

  it('execute returns the reminder message', async () => {
    const result = await pillReminder.execute();
    expect('content' in result).toBe(true);
    if (!('content' in result)) return;
    expect(result.content).toBe('💊 Time to take your pill!');
  });
});
