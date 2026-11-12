import { test, expect } from '@playwright/test';
import { HeadlessClient } from '../helpers/m21b-client';

for (const port of [3001, 3002]) {
  test(`M21b Node handshake on ${port}`, async () => {
    const client = await new HeadlessClient(port).open();
    try {
      const hello = await client.login(`m21b-${port}`);
      expect(hello.entityId).toBeGreaterThan(0);
      expect(hello.dimension).toBe('overworld');
    } finally {
      client.close();
    }
  });
}
