import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import rule from './component-handler-ack-first.js';

// The rule reads TS type annotations (param typed `ButtonInteraction`, etc.), so
// the test linter must use the typescript-eslint parser. No type program is
// needed — the rule inspects the AST annotation node, not resolved type info.
const linter = new Linter({ configType: 'flat' });

function lint(code: string): Linter.LintMessage[] {
  return linter.verify(code, [
    {
      languageOptions: {
        parser: tseslint.parser as unknown as Linter.Parser,
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      plugins: {
        test: {
          rules: {
            'ack-first': rule,
          },
        },
      },
      rules: {
        'test/ack-first': 'error',
      },
    },
  ]);
}

describe('rule metadata', () => {
  it('is a problem rule with the ackAfterAsync message', () => {
    expect(rule.meta?.type).toBe('problem');
    expect(rule.meta?.messages?.ackAfterAsync).toBeDefined();
  });
});

describe('valid — ack is the first await', () => {
  it('router handleButton: deferUpdate before async work', () => {
    expect(
      lint(`defineCommand({
        handleButton: async interaction => {
          await interaction.deferUpdate();
          const s = await findSession(interaction.message.id);
        },
      });`)
    ).toHaveLength(0);
  });

  it('sync guard (no await) may precede the ack', () => {
    expect(
      lint(`defineCommand({
        handleSelectMenu: async interaction => {
          if (!isMine(interaction.customId)) return;
          await interaction.deferUpdate();
          await doWork();
        },
      });`)
    ).toHaveLength(0);
  });

  it('typed downstream handler acks first', () => {
    expect(
      lint(`async function handleBrowsePagination(interaction: ButtonInteraction) {
        await interaction.deferUpdate();
        const s = await findSession(interaction.message.id);
      }`)
    ).toHaveLength(0);
  });

  it('double-ack guard counts as ack-first', () => {
    expect(
      lint(`async function handleBack(interaction: ButtonInteraction) {
        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferUpdate();
        }
        await loadThing();
      }`)
    ).toHaveLength(0);
  });

  it('either branch acking first is fine', () => {
    expect(
      lint(`async function handleThing(interaction: ModalSubmitInteraction) {
        if (wantsEphemeral) {
          await interaction.deferReply({ ephemeral: true });
        } else {
          await interaction.deferUpdate();
        }
      }`)
    ).toHaveLength(0);
  });

  it('awaits inside nested callbacks do not count as the handler first await', () => {
    expect(
      lint(`defineCommand({
        handleButton: async interaction => {
          await interaction.deferUpdate();
          await Promise.all(rows.map(async r => await save(r)));
        },
      });`)
    ).toHaveLength(0);
  });

  it('ignores autocomplete handlers (no ack — they respond directly)', () => {
    expect(
      lint(`async function handleAutocomplete(interaction: AutocompleteInteraction) {
        const models = await fetchModels();
        await interaction.respond(models);
      }`)
    ).toHaveLength(0);
  });

  it('ignores deferred-context subcommand handlers', () => {
    expect(
      lint(`async function handleSet(context: DeferredCommandContext) {
        const cfg = await context.fetchConfig();
        await context.editReply({ content: 'ok' });
      }`)
    ).toHaveLength(0);
  });

  it('ignores plain helpers that are not handlers', () => {
    expect(
      lint(`async function loadModels() {
        return await fetch('https://x');
      }`)
    ).toHaveLength(0);
  });

  it('exempts a router that delegates without acking (the sub-handler acks)', () => {
    expect(
      lint(`defineCommand({
        handleSelectMenu: async interaction => {
          if (isServersSelect(interaction.customId)) {
            await handleServersSelect(interaction);
            return;
          }
          await handleOtherSelect(interaction);
        },
      });`)
    ).toHaveLength(0);
  });

  it('exempts a sub-handler that relies on the caller ack (never acks itself)', () => {
    expect(
      lint(`async function handleModeToggle(interaction: ButtonInteraction) {
        const data = await getSessionOrExpired(interaction, entryId);
        if (data === null) return;
        await saveMode(data);
      }`)
    ).toHaveLength(0);
  });

  it('exempts a router that delegates in matched branches and only acks in a fallback', () => {
    expect(
      lint(`async function handleButton(interaction: ButtonInteraction) {
        if (isA(interaction.customId)) {
          await handleA(interaction);
          return;
        }
        if (isB(interaction.customId)) {
          await handleB(interaction);
          return;
        }
        await interaction.reply({ content: 'Unknown interaction.' });
      }`)
    ).toHaveLength(0);
  });
});

describe('invalid — async work before the ack', () => {
  it('router handleButton awaits a session lookup before deferUpdate', () => {
    const messages = lint(`defineCommand({
      handleButton: async interaction => {
        const session = await findSession(interaction.message.id);
        await interaction.deferUpdate();
      },
    });`);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('ackAfterAsync');
  });

  it('typed downstream handler awaits a lookup before the ack', () => {
    expect(
      lint(`async function handleBrowsePagination(interaction: ButtonInteraction) {
        const session = await findSession(interaction.message.id);
        await interaction.deferUpdate();
      }`)
    ).toHaveLength(1);
  });

  it('awaiting a non-interaction method first does not satisfy the rule', () => {
    expect(
      lint(`defineCommand({
        handleSelectMenu: async interaction => {
          await someService.update();
          await interaction.deferUpdate();
        },
      });`)
    ).toHaveLength(1);
  });

  it('a nested-callback await does not mask a real pre-ack lookup', () => {
    expect(
      lint(`defineCommand({
        handleButton: async interaction => {
          rows.forEach(async r => { await save(r); });
          const session = await findSession(interaction.message.id);
          await interaction.deferUpdate();
        },
      });`)
    ).toHaveLength(1);
  });

  it('a BARE ack after a fetch is flagged even when the data shapes the ack (must wrap)', () => {
    // The modal/inspect-then-ack family: must fetch first, so a BARE showModal
    // after the fetch is the bug — it should go through a *WithTimeoutCatch wrapper.
    expect(
      lint(`async function handleEditButton(interaction: ButtonInteraction) {
        const memory = await fetchMemory(memoryId);
        await interaction.showModal(modal);
      }`)
    ).toHaveLength(1);
  });
});

describe('wrapper-ack family — a necessarily-late ack via *WithTimeoutCatch is allowed', () => {
  it('fetch then showModalWithTimeoutCatch(interaction) passes (wrapped late ack)', () => {
    // Ack-first is impossible here (the modal is prefilled from the fetched row),
    // so the timeout-catch wrapper IS the accepted mitigation — not a violation.
    expect(
      lint(`async function handleEditButton(interaction: ButtonInteraction) {
        const memory = await fetchMemory(memoryId);
        await showModalWithTimeoutCatch(interaction, modal, ctx, 'msg');
      }`)
    ).toHaveLength(0);
  });

  it('getSession then ackWithTimeoutCatch(interaction, () => reply) passes', () => {
    expect(
      lint(`async function handleEdit(interaction: ButtonInteraction) {
        const session = await getSession(interaction.user.id);
        await ackWithTimeoutCatch(interaction, () => interaction.reply({ content: 'x' }), {}, 'm');
      }`)
    ).toHaveLength(0);
  });

  it('a wrapped ack with no preceding async passes', () => {
    expect(
      lint(`async function handleEditButton(interaction: ButtonInteraction) {
        await showModalWithTimeoutCatch(interaction, modal, ctx, 'msg');
      }`)
    ).toHaveLength(0);
  });

  it('real async then a delegation (interaction handed off) is not flagged', () => {
    expect(
      lint(`async function handleButton(interaction: ButtonInteraction) {
        const meta = await loadMeta(thingId);
        await routeToSubHandler(interaction, meta);
      }`)
    ).toHaveLength(0);
  });

  it('exempts a delegation that passes the interaction inside an options object', () => {
    // fetchOrCreateSession({ ..., interaction }) is an ack-capable helper; the
    // interaction rides in an options bag, not as a direct arg. It must still
    // read as a handoff, not as real async work before the following reply.
    expect(
      lint(`async function handleSelect(interaction: StringSelectMenuInteraction) {
        const result = await fetchOrCreateSession({ entityId, interaction });
        if (!result.success) {
          await interaction.reply({ content: 'not found' });
        }
      }`)
    ).toHaveLength(0);
  });

  it('fails closed when the interaction param cannot be resolved (destructured param)', () => {
    // interactionName is unresolvable from a destructured param, so a bare
    // `.reply()` on some OTHER object must NOT be misread as THE interaction ack
    // (fail closed rather than permissive — otherwise it could mask a real
    // violation). We conservatively skip the handler instead of guessing.
    expect(
      lint(`defineCommand({
        handleButton: async ({ message }) => {
          const data = await load(message.id);
          await message.reply(data);
        },
      });`)
    ).toHaveLength(0);
  });
});

describe('detection coverage — handleModal router key', () => {
  it('flags a handleModal router entry that acks after async', () => {
    // handleModal is a raw-interaction router key too; an untyped arrow entry
    // that fetches before the ack must be caught, same as handleButton.
    expect(
      lint(`defineCommand({
        handleModal: async interaction => {
          const row = await fetchRow(interaction.customId);
          await interaction.reply({ content: row.name });
        },
      });`)
    ).toHaveLength(1);
  });
});
