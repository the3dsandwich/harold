import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import * as jobs from '../src/jobs/index.js';

describe('job test coverage', () => {
  it('every registered job has a corresponding test file', () => {
    const allJobs = Object.values(jobs);
    const missing = allJobs
      .map((job) => `test/jobs/${job.id}.test.ts`)
      .filter((path) => !existsSync(path));

    expect(missing, `missing test files: ${missing.join(', ')}`).toEqual([]);
  });
});
