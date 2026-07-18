/**
 * Tests for the declarative component-interaction router.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import { createComponentRouter, type ComponentRoute } from './componentRouter.js';

function interaction(customId: string): ButtonInteraction {
  return { customId } as unknown as ButtonInteraction;
}

describe('createComponentRouter', () => {
  it('dispatches to the first matching route with a handler of the right kind', async () => {
    const first = vi.fn().mockResolvedValue(undefined);
    const second = vi.fn().mockResolvedValue(undefined);
    const router = createComponentRouter({
      routes: [
        { matches: id => id.startsWith('a::'), onButton: first },
        { matches: () => true, onButton: second },
      ],
    });

    await router.handleButton(interaction('a::x'));

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('skips a matching route that lacks the interaction kind handler', async () => {
    const buttonOnly = vi.fn().mockResolvedValue(undefined);
    const modalHandler = vi.fn().mockResolvedValue(undefined);
    const router = createComponentRouter({
      routes: [
        // Matches everything but only handles buttons — a modal must fall through.
        { matches: () => true, onButton: buttonOnly },
        { matches: id => id.startsWith('m::'), onModal: modalHandler },
      ],
    });

    await router.handleModal(interaction('m::edit') as unknown as ModalSubmitInteraction);

    expect(buttonOnly).not.toHaveBeenCalled();
    expect(modalHandler).toHaveBeenCalledTimes(1);
  });

  it('preserves table order when multiple routes match', async () => {
    const calls: string[] = [];
    const mk = (label: string) =>
      vi.fn(async () => {
        calls.push(label);
      });
    const router = createComponentRouter({
      routes: [
        { matches: id => id.includes('shared-stem'), onButton: mk('specific') },
        { matches: id => id.includes('shared'), onButton: mk('broad') },
      ],
    });

    await router.handleButton(interaction('shared-stem::x'));

    expect(calls).toEqual(['specific']);
  });

  it('invokes the unrouted fallback when no route claims the interaction', async () => {
    const unrouted = vi.fn().mockResolvedValue(undefined);
    const router = createComponentRouter({
      routes: [{ matches: id => id.startsWith('a::'), onButton: vi.fn() }],
      unrouted,
    });

    const i = interaction('unknown::x');
    await router.handleButton(i);

    expect(unrouted).toHaveBeenCalledWith(i, 'button');
  });

  it('logs and returns when unrouted and no fallback is provided', async () => {
    const router = createComponentRouter({
      routes: [{ matches: () => false, onButton: vi.fn() }],
    });

    await expect(router.handleButton(interaction('nope'))).resolves.toBeUndefined();
  });

  it('routes each interaction kind independently over one table', async () => {
    const onButton = vi.fn().mockResolvedValue(undefined);
    const onSelect = vi.fn().mockResolvedValue(undefined);
    const onModal = vi.fn().mockResolvedValue(undefined);
    const route: ComponentRoute = {
      matches: id => id.startsWith('multi::'),
      onButton,
      onSelect,
      onModal,
    };
    const router = createComponentRouter({ routes: [route] });

    await router.handleButton(interaction('multi::b'));
    await router.handleSelectMenu(interaction('multi::s') as never);
    await router.handleModal(interaction('multi::m') as never);

    expect(onButton).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onModal).toHaveBeenCalledTimes(1);
  });

  it('propagates handler rejections (no swallowing)', async () => {
    const router = createComponentRouter({
      routes: [
        {
          matches: () => true,
          onButton: vi.fn().mockRejectedValue(new Error('handler failed')),
        },
      ],
    });

    await expect(router.handleButton(interaction('x'))).rejects.toThrow('handler failed');
  });
});
