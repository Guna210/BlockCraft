import { it, expect } from 'vitest';
import { Inventory } from '../../src/gameplay/inventory';
import { RemoteInventory } from '../../src/game/net/inventory';
import { MessageType as T, InventoryAction as A, type Message } from '../../src/net/protocol';
it('serializes window-zero intent by revision and updates only from authoritative slots', () => {
  const inventory = new Inventory(),
    messages: Message[] = [];
  const adapter = new RemoteInventory(inventory, {
    send: (message: Message) => messages.push(message),
  });
  adapter.sync({
    type: T.InventorySync,
    windowId: 0,
    revision: 10,
    slots: [{ id: 'dirt', count: 4 }],
    cursor: null,
  });
  expect(messages[0]).toMatchObject({
    type: T.InventoryTransaction,
    action: A.SelectSlot,
    slot: 0,
    revision: 10,
  });
  adapter.result({
    type: T.InventoryResult,
    requestId: 1,
    revision: 11,
    accepted: true,
    reason: '',
  });
  messages.length = 0;
  inventory.consumeSelected();
  expect(inventory.slots[0]?.count).toBe(4);
  inventory.leftClick(0);
  inventory.rightClick(1);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({
    type: T.InventoryTransaction,
    revision: 11,
    action: A.LeftClick,
  });
  expect(inventory.slots[0]?.count).toBe(4);
  adapter.result({
    type: T.InventoryResult,
    requestId: 2,
    revision: 12,
    accepted: true,
    reason: '',
  });
  expect(messages).toHaveLength(2);
  expect(messages[1]).toMatchObject({ revision: 12, action: A.RightClick });
  adapter.sync({
    type: T.InventorySync,
    windowId: 0,
    revision: 12,
    slots: [],
    cursor: { id: 'dirt', count: 4 },
  });
  expect(inventory.slots[0]).toBeNull();
  expect(inventory.cursor?.count).toBe(4);
});
