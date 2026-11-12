import { test, expect } from '../harness/fixture';
import { assertHealthy, connect, second } from './helpers/m21c';
test('chat from A reaches B through the server and commands stay unavailable', async ({
  page,
  browser,
}) => {
  const b = await second(browser);
  try {
    const unique = Date.now().toString(36),
      name = `chat-A-${unique}`;
    await connect(page, name);
    await connect(b.page, `chat-B-${unique}`);
    const text = `hello <b>${unique}</b>\u2028\u200b\u202e`;
    await page.keyboard.press('KeyT');
    await page.locator('#chat-input').fill(text);
    await page.keyboard.press('Enter');
    await expect(b.page.locator('#chat-lines')).toContainText(
      `${name}: hello <b>${unique}</b>\\u2028\\u200b\\u202e`,
    );
    await expect(b.page.locator('#chat-lines b')).toHaveCount(0);
    await page.keyboard.press('Slash');
    await page.locator('#chat-input').fill('/give @s stone 64');
    await page.keyboard.press('Enter');
    await expect(page.locator('#chat-lines')).toContainText(
      'Commands are unavailable in multiplayer',
    );
    await assertHealthy(b.page, b.errors);
  } finally {
    await b.context.close();
  }
});
