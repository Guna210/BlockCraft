import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

describe('lint:placeholders', () => {
  it('detects a planted TODO in a temporary file and passes when removed', () => {
    const tempFilePath = path.join(process.cwd(), 'src', 'temp_todo_test.ts');

    try {
      // Plant a TODO
      fs.writeFileSync(tempFilePath, '// TODO: fix this', 'utf-8');

      let failed = false;
      try {
        execSync('npm run lint:placeholders', { stdio: 'ignore' });
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);

      // Remove the TODO
      fs.unlinkSync(tempFilePath);

      let failedAfterRemoval = false;
      try {
        execSync('npm run lint:placeholders', { stdio: 'ignore' });
      } catch {
        failedAfterRemoval = true;
      }
      expect(failedAfterRemoval).toBe(false);
    } finally {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }
  });
});
