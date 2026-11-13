import { macroDigest } from './macroDigest.js';
import {
  canControl,
  handoutDigest,
  tableToolDigest,
  emptyTracker,
  sceneSchema,
  pinDigest,
  tokenSchema,
  tokenVisible,
  macroVisible,
  REDACTED_TURN_ID,
  publicToken,
  statusDigest,
  zoneDigest,
  encounterDigest,
  type DurableRoom,
  type StateChange,
  type Token,
} from './model.js';
import type { ClientMessage } from './protocol.js';
import { validateAsset } from './assets.js';
import { clampPoint, snapPoint } from './geometry.js';
import { evaluateDice, parseDice } from './dice.js';
import { sampleScene } from './sample.js';
import { importMacros, parseMacro, evaluateMacro } from './macros.js';
import { planMacroImport } from './macroImport.js';
import { applyTokenEdits } from './tokenEdits.js';
import { applyChanges } from './state.js';
import {
  parseCharacter,
  characterDigest,
  characterVisible,
  characterControlled,
  characterDefinitionSchema,
  unavailableAbility,
  type CharacterSheet,
} from './characters.js';
export function assertAsset(room: DurableRoom, asset: Token['image']) {
  validateAsset(asset);
  if (asset.kind === 'uploaded' && !room.state.assets?.[asset.url])
    throw new Error('That image is not part of this campaign.');
}
/** All validation happens before applying any member of a batch. */
export function prepareAction(
  room: DurableRoom,
  user: { id: string; name: string },
  m: ClientMessage,
  randomInt: (min: number, max: number) => number,
  role = room.members[user.id]?.role,
): StateChange[] {
  const randomUUID = () => crypto.randomUUID();
  const state = room.state;
  const playerIds = Object.entries(room.members)
    .filter(([, member]) => member.role === 'player')
    .map(([id]) => id);
  if (!role) throw new Error('You are no longer a member of this campaign.');
  const gm = () => {
    if (role !== 'gm') throw new Error('Only the game master can change this.');
  };
  const character = (id: string) => {
    const sheet =
      state.characters && Object.hasOwn(state.characters, id) ? state.characters[id] : undefined;
    if (!sheet || !characterVisible(sheet, user.id, role)) throw new Error('Character not found.');
    if (!characterControlled(sheet, user.id, role))
      throw new Error('Only this character’s owner or a game master can change it.');
    return sheet;
  };
  const sheetChange = (sheet: CharacterSheet): StateChange => ({
    kind: 'character',
    id: sheet.id,
    character: sheet,
  });
  const linkedTokens = (id: string): Token[] =>
    [
      ...Object.values(state.scenes).flatMap((s) => Object.values(s.tokens)),
      ...Object.values(state.tokenLibrary || {}),
      ...Object.values(state.encounters || {}).flatMap((e) => e.tokens),
    ].filter((t) => t.characterId === id);
  const scene = (id: string) => {
    const s = state.scenes[id];
    if (!s || (role !== 'gm' && s.visibility === 'gm' && id !== state.activeSceneId))
      throw new Error('Scene not found.');
    return s;
  };
  const controlled = (sceneId: string, id: string) => {
    const s = scene(sceneId),
      t = s.tokens[id];
    if (!t || !canControl(t, user.id, role) || !tokenVisible(t, s, role, user.id, playerIds))
      throw new Error('You do not control that token.');
    return { s, t };
  };
  const translateZone = (zone: import('./model.js').Zone, dx: number, dy: number) => ({
    ...zone,
    x: zone.x + dx,
    y: zone.y + dy,
    points: zone.points?.map((p) => ({ x: p.x + dx, y: p.y + dy })),
  });
  const move = (
    sceneId: string,
    tokenId: string,
    position: { x: number; y: number },
  ): StateChange[] => {
    const { s, t } = controlled(sceneId, tokenId);
    const nextPosition = clampPoint(snapPoint(position, s.grid), s.width, s.height, t.size);
    const dx = nextPosition.x - t.x,
      dy = nextPosition.y - t.y;
    const zones: StateChange[] = Object.values(s.zones)
      .filter((zone) => zone.anchorTokenId === tokenId)
      .map((zone) => ({
        kind: 'zone',
        sceneId,
        zone: translateZone(zone, dx, dy),
      }));
    return [
      {
        kind: 'token',
        sceneId,
        token: { ...t, ...nextPosition },
      },
      ...zones,
    ];
  };
  const update = (sceneId: string, tokens: Token[]): StateChange[] => {
    gm();
    const s = scene(sceneId);
    const ids = new Set([...Object.keys(s.tokens), ...tokens.map((t) => t.id)]);
    if (ids.size > 100) throw new Error('A scene supports up to 100 tokens.');
    if (new Set(tokens.map((t) => t.id)).size !== tokens.length)
      throw new Error('Duplicate token identifiers in batch.');
    return tokens.flatMap((token): StateChange[] => {
      assertAsset(room, token.image);
      if (
        token.characterId &&
        token.characterId !== s.tokens[token.id]?.characterId &&
        !Object.hasOwn(state.characters || {}, token.characterId)
      )
        throw new Error('Linked character not found. Choose another sheet or unlink it.');
      if (
        token.resourceId &&
        (token.resourceId !== s.tokens[token.id]?.resourceId ||
          token.characterId !== s.tokens[token.id]?.characterId) &&
        (!token.characterId ||
          !state.characters?.[token.characterId]?.resources.some((r) => r.id === token.resourceId))
      )
        throw new Error('Linked resource not found on that character.');
      const next = tokenSchema.parse({
        ...token,
        ...clampPoint(token, s.width, s.height, token.size),
      });
      const old = s.tokens[token.id];
      const zones: StateChange[] = old
        ? Object.values(s.zones)
            .filter(
              (zone) => zone.anchorTokenId === token.id && (next.x !== old.x || next.y !== old.y),
            )
            .map((zone) => ({
              kind: 'zone',
              sceneId,
              zone: translateZone(zone, next.x - old.x, next.y - old.y),
            }))
        : [];
      return [
        {
          kind: 'token',
          sceneId,
          token: next,
        },
        ...zones,
      ];
    });
  };
  switch (m.type) {
    case 'CHARACTER_IMPORT': {
      const existing =
        state.characters && Object.hasOwn(state.characters, m.id)
          ? state.characters[m.id]
          : undefined;
      if (existing) {
        character(m.id);
        if (m.digest !== characterDigest(existing))
          throw new Error(
            'This character changed since the preview. Reload its current text before replacing it.',
          );
      } else {
        if (m.digest)
          throw new Error('This character was removed. Import as a new character instead.');
        const sheets = Object.values(state.characters || {});
        if (sheets.length >= 50 || sheets.filter((s) => s.ownerId === user.id).length >= 20)
          throw new Error('Save at most 20 characters per person and 50 per campaign.');
      }
      const definition = parseCharacter(m.text);
      if (
        existing &&
        linkedTokens(m.id).some(
          (t) => t.resourceId && !definition.resources.some((r) => r.id === t.resourceId),
        )
      )
        throw new Error(
          'A token or saved encounter uses a resource removed by this edit. Unlink or repair it first.',
        );
      return [
        sheetChange({
          ...definition,
          id: m.id,
          ownerId: existing?.ownerId || user.id,
          visibility: m.visibility,
        }),
      ];
    }
    case 'CHARACTER_DELETE': {
      const sheet = character(m.id);
      if (m.digest !== characterDigest(sheet))
        throw new Error('This character changed. Review it before deleting.');
      if (linkedTokens(m.id).length)
        throw new Error(
          'This character is linked to tokens or saved encounters. Unlink or repair them before deleting.',
        );
      return [{ kind: 'character', id: m.id, character: null }];
    }
    case 'CHARACTER_ASSIGN': {
      gm();
      const sheet = character(m.id);
      if (!Object.hasOwn(room.members, m.ownerId))
        throw new Error('Choose a current campaign member.');
      return [sheetChange({ ...sheet, ownerId: m.ownerId })];
    }
    case 'CHARACTER_RESOURCE_ADJUST': {
      const sheet = character(m.id);
      if (!sheet.resources.some((r) => r.id === m.resourceId))
        throw new Error('Resource not found.');
      return [
        sheetChange({
          ...sheet,
          resources: sheet.resources.map((r) =>
            r.id === m.resourceId
              ? { ...r, current: Math.max(r.min ?? 0, Math.min(r.max, r.current + m.delta)) }
              : r,
          ),
        }),
      ];
    }
    case 'CHARACTER_REFRESH': {
      const sheet = character(m.id);
      return [
        sheetChange({
          ...sheet,
          resources: sheet.resources.map((r) =>
            r.refresh === m.refresh ? { ...r, current: r.max } : r,
          ),
          abilities: sheet.abilities.map((a) =>
            a.refresh === m.refresh ? { ...a, remainingUses: a.maxUses } : a,
          ),
        }),
      ];
    }
    case 'CHARACTER_ABILITY_STATE': {
      const sheet = character(m.id);
      if (!sheet.abilities.some((a) => a.id === m.abilityId)) throw new Error('Ability not found.');
      return [
        sheetChange({
          ...sheet,
          abilities: sheet.abilities.map((a) =>
            a.id !== m.abilityId
              ? a
              : m.operation === 'recover'
                ? { ...a, remainingUses: a.maxUses }
                : { ...a, prepared: m.operation === 'prepare' },
          ),
        }),
      ];
    }
    case 'CHARACTER_ABILITY_SAVE': {
      const sheet = character(m.id);
      if (m.digest !== characterDigest(sheet))
        throw new Error('This character changed. Review it before saving.');
      const exists = sheet.abilities.some((ability) => ability.id === m.ability.id);
      const abilities = exists
        ? sheet.abilities.map((ability) => (ability.id === m.ability.id ? m.ability : ability))
        : [...sheet.abilities, m.ability];
      characterDefinitionSchema.parse({ ...sheet, abilities });
      return [sheetChange({ ...sheet, abilities })];
    }
    case 'CHARACTER_ABILITY_USE': {
      const sheet = character(m.id),
        ability = sheet.abilities.find((a) => a.id === m.abilityId);
      if (!ability) throw new Error('Ability not found.');
      const unavailable = unavailableAbility(sheet, ability);
      if (unavailable) throw new Error(`${ability.name}: ${unavailable}.`);
      const definition = ability.macro ? parseMacro(ability.macro) : null;
      const variables = Object.fromEntries(
        (definition?.variables || []).map((name) => [
          name,
          Object.hasOwn(sheet.stats, name) ? sheet.stats[name] : m.variables[name],
        ]),
      );
      if (
        Object.keys(m.variables).some(
          (name) => !definition?.variables.includes(name) || Object.hasOwn(sheet.stats, name),
        )
      )
        throw new Error('Supply only the action’s unbound numeric inputs.');
      const result = definition
        ? evaluateMacro(definition, variables, randomInt)
        : {
            name: ability.name,
            variables: {},
            groups: [
              {
                name: 'Effect',
                terms: [],
                contributions: [],
                total: 0,
                selections: [ability.text || ability.name],
              },
            ],
          };
      const remainingUses = ability.maxUses ? ability.remainingUses - 1 : 0;
      const resources = sheet.resources.map((r) => ({
        ...r,
        current: r.current - (ability.costs.find((c) => c.resourceId === r.id)?.amount || 0),
      }));
      return [
        sheetChange({
          ...sheet,
          resources,
          abilities: sheet.abilities.map((a) =>
            a.id === ability.id ? { ...a, remainingUses } : a,
          ),
        }),
        {
          kind: 'roll',
          roll: {
            id: randomUUID(),
            actionId: m.actionId,
            userId: user.id,
            userName: user.name,
            expression: ability.name,
            terms: result.groups.flatMap((g) => g.terms),
            total: result.groups[0].total,
            macro: { ...result, name: ability.name },
            visibility: m.visibility,
            createdAt: new Date().toISOString(),
            character: {
              characterId: sheet.id,
              abilityId: ability.id,
              name: sheet.name,
              ability: ability.name,
              text: ability.text,
              remainingUses: ability.maxUses ? remainingUses : null,
              maxUses: ability.maxUses,
              resources: resources
                .filter((r) => ability.costs.some((c) => c.resourceId === r.id))
                .map((r) => ({
                  name: r.name,
                  current: r.current,
                  max: r.max,
                  spent: ability.costs.find((c) => c.resourceId === r.id)!.amount,
                })),
            },
          },
        },
      ];
    }
    case 'MACRO_IMPORT': {
      const imported = importMacros(m.text);
      if (imported.errors.length)
        throw new Error(`Line ${imported.errors[0].line}: ${imported.errors[0].message}`);
      const existing = Object.values(state.macros || {});
      const plan = planMacroImport(imported.macros, existing, user.id);
      const replacements = m.replacements || [];
      if (
        new Set(replacements.map((r) => r.line)).size !== replacements.length ||
        new Set(replacements.map((r) => r.id)).size !== replacements.length
      )
        throw new Error('Duplicate macro replacements.');
      // Check every replacement before preparing any changes. Stale previews must be reviewed again.
      for (const replacement of replacements) {
        const entry = plan.find((p) => p.definition.line === replacement.line);
        const target = entry?.matches.find((macro) => macro.id === replacement.id);
        if (
          !entry ||
          entry.status !== 'changed' ||
          !target ||
          macroDigest(target) !== replacement.digest
        )
          throw new Error('The macro changed since this preview. Review the import again.');
      }
      const additions = plan.filter((p) => p.status === 'new').length;
      if (
        existing.length + additions > 200 ||
        existing.filter((macro) => macro.ownerId === user.id).length + additions > 100
      )
        throw new Error('Save at most 100 macros per person and 200 per campaign.');
      return plan.flatMap(({ definition, matches, status }) => {
        const replacement = replacements.find((r) => r.line === definition.line);
        if (status === 'unchanged' || (status === 'changed' && !replacement)) return [];
        const previous = matches.find((macro) => macro.id === replacement?.id);
        const id = previous?.id || randomUUID();
        return [
          {
            kind: 'macro' as const,
            id,
            macro: {
              id,
              name: definition.name,
              source: definition.source,

              ownerId: user.id,
              // Updating a private macro must never make it public through the new-import default.
              visibility: previous?.visibility || m.visibility,
            },
          },
        ];
      });
    }
    case 'MACRO_DELETE': {
      const macro =
        state.macros && Object.hasOwn(state.macros, m.id) ? state.macros[m.id] : undefined;
      if (!macro || !macroVisible(macro, user.id, role)) throw new Error('Macro not found.');
      if (macro.ownerId !== user.id && role !== 'gm')
        throw new Error('Only its author or a game master can remove this macro.');
      return [{ kind: 'macro', id: m.id, macro: null }];
    }
    case 'MACRO_ROLL_REQUEST': {
      const macro =
        state.macros && Object.hasOwn(state.macros, m.id) ? state.macros[m.id] : undefined;
      if (!macro || !macroVisible(macro, user.id, role)) throw new Error('Macro not found.');
      const result = evaluateMacro(parseMacro(macro.source), m.variables, randomInt);
      return [
        {
          kind: 'roll',
          roll: {
            id: randomUUID(),
            actionId: m.actionId,
            userId: user.id,
            userName: user.name,
            expression: macro.name,
            terms: result.groups.flatMap((group) => group.terms),
            total: result.groups[0].total,
            macro: result,
            visibility: m.visibility,
            createdAt: new Date().toISOString(),
          },
        },
      ];
    }
    case 'TOKEN_MOVE_COMMIT':
      return move(m.sceneId, m.tokenId, m.position);
    case 'TOKEN_ROTATE': {
      const { t } = controlled(m.sceneId, m.tokenId);
      return [
        {
          kind: 'token',
          sceneId: m.sceneId,
          token: { ...t, rotation: (t.rotation + m.delta + 360) % 360 },
        },
      ];
    }
    case 'TOKEN_MOVE_BATCH':
      if (new Set(m.positions.map((p) => p.tokenId)).size !== m.positions.length)
        throw new Error('Duplicate token identifiers in batch.');
      return m.positions.flatMap((p) => move(m.sceneId, p.tokenId, p.position));
    case 'TOKEN_RESOURCE_ADJUST': {
      const { t } = controlled(m.sceneId, m.tokenId);
      if (
        m.expected &&
        (m.expected.characterId !== (t.characterId || null) ||
          m.expected.resourceId !== (t.resourceId || null) ||
          m.expected.label !== (t.resourceId ? null : (t.resource?.label ?? null)))
      )
        throw new Error('The target resource changed. Review it before applying the result.');
      if (t.resourceId) {
        if (!t.characterId) throw new Error('Linked character not found.');
        if (!Number.isInteger(m.delta)) throw new Error('Linked resources use whole numbers.');
        const sheet = character(t.characterId);
        if (!sheet.resources.some((r) => r.id === t.resourceId))
          throw new Error('Linked resource not found.');
        return [
          sheetChange({
            ...sheet,
            resources: sheet.resources.map((r) =>
              r.id === t.resourceId
                ? { ...r, current: Math.max(r.min ?? 0, Math.min(r.max, r.current + m.delta)) }
                : r,
            ),
          }),
        ];
      }
      if (!t.resource) throw new Error('This token has no resource counter.');
      return [
        {
          kind: 'token',
          sceneId: m.sceneId,
          token: {
            ...t,
            resource: {
              ...t.resource,
              value: Math.max(
                t.resource.min ?? 0,
                Math.min(t.resource.max, t.resource.value + m.delta),
              ),
            },
          },
        },
      ];
    }
    case 'TOKEN_STATUS_SET': {
      const { t } = controlled(m.sceneId, m.tokenId);
      const current = t.statuses?.find((entry) => entry.id === m.status.id);
      const visible =
        role === 'gm'
          ? current
          : publicToken(t).statuses?.find((entry) => entry.id === m.status.id);
      if (current ? !m.expected || m.expected !== statusDigest(visible!) : !!m.expected)
        throw new Error(
          'This condition changed or expired. Review the latest condition before saving.',
        );
      let status = m.status;
      if (role !== 'gm' && status.duration?.participantId === REDACTED_TURN_ID) {
        const original = t.statuses?.find((entry) => entry.id === status.id)?.duration;
        if (!original) throw new Error('Choose a participant in the turn tracker.');
        status = {
          ...status,
          duration: { ...status.duration, participantId: original.participantId },
        };
      }
      if (
        status.duration &&
        !(state.tracker || emptyTracker()).entries.some(
          (e) => e.id === status.duration!.participantId,
        )
      )
        throw new Error('Choose a participant in the turn tracker.');
      const statuses = t.statuses || [];
      if (!statuses.some((s) => s.id === m.status.id) && statuses.length >= 16)
        throw new Error('Token status limit reached.');
      return [
        {
          kind: 'token',
          sceneId: m.sceneId,
          token: { ...t, statuses: [...statuses.filter((s) => s.id !== status.id), status] },
        },
      ];
    }
    case 'TABLE_TOOL_SAVE': {
      gm();
      const old = state.tableTools?.[m.tool.id];
      if (old ? !m.digest || tableToolDigest(old) !== m.digest : !!m.digest)
        throw new Error('This table tool changed. Reopen it before saving.');
      if (old && old.kind !== m.tool.kind) throw new Error('Cannot change the type of a table tool.');
      if (!old && Object.keys(state.tableTools || {}).length >= 50)
        throw new Error('A campaign supports up to 50 table tools.');
      return [{ kind: 'table-tool', id: m.tool.id, tool: m.tool }];
    }
    case 'TABLE_TOOL_DELETE':
      gm();
      if (!state.tableTools?.[m.id]) throw new Error('Table tool not found.');
      return [{ kind: 'table-tool', id: m.id, tool: null }];
    case 'TABLE_TOOL_ADJUST': {
      const tool = state.tableTools?.[m.id];
      if (!tool || tool.kind === 'table') throw new Error('Counter not found.');
      const value = Math.max(tool.kind === 'clock' ? 0 : -1000000, Math.min(tool.kind === 'clock' ? tool.segments : 1000000, tool.value + m.delta));
      if (value === tool.value) return [];
      return [{ kind: 'table-tool', id: m.id, tool: { ...tool, value } }];
    }
    case 'HANDOUT_SAVE': {
      gm();
      const old = state.handouts?.[m.handout.id];
      if (old ? !m.digest || handoutDigest(old) !== m.digest : !!m.digest)
        throw new Error('This handout changed. Reopen it before saving.');
      if (!old && Object.keys(state.handouts || {}).length >= 50)
        throw new Error('A campaign supports up to 50 handouts.');
      if (m.handout.imageUrl) validateAsset({ kind: 'external', url: m.handout.imageUrl });
      return [{ kind: 'handout', id: m.handout.id, handout: m.handout }];
    }
    case 'HANDOUT_DELETE': {
      gm();
      const old = state.handouts?.[m.id];
      if (!old || handoutDigest(old) !== m.digest)
        throw new Error('This handout changed. Reopen it before deleting.');
      return [{ kind: 'handout', id: m.id, handout: null }];
    }
    case 'STATUS_PRESET_SET':
      gm();
      if (
        !state.statusPresets?.[m.preset.id] &&
        Object.keys(state.statusPresets || {}).length >= 100
      )
        throw new Error('Condition preset limit reached.');
      return [{ kind: 'status-preset', id: m.preset.id, preset: m.preset }];
    case 'STATUS_PRESET_DELETE':
      gm();
      return [{ kind: 'status-preset', id: m.id, preset: null }];
    case 'TOKEN_STATUS_REMOVE': {
      const { t } = controlled(m.sceneId, m.tokenId);
      if (!t.statuses?.some((s) => s.id === m.statusId)) throw new Error('Status not found.');
      return [
        {
          kind: 'token',
          sceneId: m.sceneId,
          token: { ...t, statuses: t.statuses.filter((s) => s.id !== m.statusId) },
        },
      ];
    }
    case 'TOKEN_BATCH_ACTION': {
      if (new Set(m.tokenIds).size !== m.tokenIds.length)
        throw new Error('Duplicate tokens in batch.');
      let temporary = room.state;
      const changes: StateChange[] = [];
      const seenResources = new Set<string>();
      for (const tokenId of m.tokenIds) {
        const token = controlled(m.sceneId, tokenId).t;
        if (m.operation.kind === 'adjust-resource' && token.characterId && token.resourceId) {
          const key = `${token.characterId}/${token.resourceId}`;
          if (seenResources.has(key))
            throw new Error('Selected tokens share a resource. Adjust it once instead.');
          seenResources.add(key);
        }
        let actions: ClientMessage[] = [];
        if (m.operation.kind === 'adjust-resource')
          actions = [{ ...m, type: 'TOKEN_RESOURCE_ADJUST', tokenId, delta: m.operation.delta }];
        else if (m.operation.kind === 'add-status')
          actions = [
            {
              ...m,
              type: 'TOKEN_STATUS_SET',
              tokenId,
              status: { ...m.operation.status, id: randomUUID() },
            },
          ];
        else {
          const label = m.operation.label.toLowerCase();
          actions = (token.statuses || [])
            .filter((status) => status.label.toLowerCase() === label)
            .map((status) => ({
              ...m,
              type: 'TOKEN_STATUS_REMOVE' as const,
              tokenId,
              statusId: status.id,
            }));
        }
        for (const action of actions) {
          const next = prepareAction({ ...room, state: temporary }, user, action, randomInt, role);
          changes.push(...next);
          temporary = applyChanges(temporary, next);
        }
      }
      if (!changes.length) throw new Error('No matching conditions were found.');
      return changes;
    }
    case 'TOKEN_UPDATE':
      gm();
      if (m.createOnly && scene(m.sceneId).tokens[m.token.id])
        throw new Error('This token already exists. Reload the latest token values before saving.');
      return update(m.sceneId, [m.token]);
    case 'TOKEN_PATCH': {
      gm();
      const current = scene(m.sceneId).tokens[m.tokenId];
      if (!current)
        throw new Error('This token was removed. Close this dialog and select another token.');
      return update(m.sceneId, [applyTokenEdits(current, m.edits)]);
    }
    case 'TOKENS_UPDATE':
      return update(m.sceneId, m.tokens);
    case 'TOKENS_DELETE':
      gm();
      return [
        ...m.ids.map((tokenId): StateChange => ({
          kind: 'token-delete',
          sceneId: m.sceneId,
          tokenId,
        })),
        ...Object.values(scene(m.sceneId).zones)
          .filter((z) => z.anchorTokenId && m.ids.includes(z.anchorTokenId))
          .map((zone): StateChange => ({
            kind: 'zone',
            sceneId: m.sceneId,
            zone: { ...zone, anchorTokenId: undefined },
          })),
      ];
    case 'TOKEN_DELETE':
      gm();
      return [
        { kind: 'token-delete', sceneId: m.sceneId, tokenId: m.tokenId },
        ...Object.values(scene(m.sceneId).zones)
          .filter((z) => z.anchorTokenId === m.tokenId)
          .map((zone): StateChange => ({
            kind: 'zone',
            sceneId: m.sceneId,
            zone: { ...zone, anchorTokenId: undefined },
          })),
      ];
    case 'SCENE_CONFIG': {
      gm();
      if (!m.create && m.sceneId === state.activeSceneId && m.visibility === 'gm')
        throw new Error('The active scene must remain visible.');
      assertAsset(room, m.map);
      if (m.create && Object.keys(state.scenes).length >= 10)
        throw new Error('A campaign supports up to ten scenes.');
      if (m.create && state.scenes[m.sceneId]) throw new Error('Scene already exists.');
      const original = m.create
          ? {
              ...sampleScene(m.sceneId, m.name),
              tokens: {},
              zones: {},
              annotations: {},
              fog: { enabled: false, revealed: [] },
            }
          : scene(m.sceneId),
        tokens = Object.fromEntries(
          Object.entries(original.tokens).map(([id, t]) => {
            const size = Math.min(t.size, m.width, m.height);
            return [id, { ...t, size, ...clampPoint(t, m.width, m.height, size) }];
          }),
        );
      const zones = Object.fromEntries(
        Object.entries(original.zones).map(([id, zone]) => {
          const old = zone.anchorTokenId && original.tokens[zone.anchorTokenId];
          const next = zone.anchorTokenId && tokens[zone.anchorTokenId];
          return [id, old && next ? translateZone(zone, next.x - old.x, next.y - old.y) : zone];
        }),
      );
      return [
        {
          kind: 'scene',
          scene: {
            ...original,
            visibility: m.visibility ?? original.visibility,
            name: m.name,
            map: m.map,
            width: m.width,
            height: m.height,
            tokens,
            zones,
          },
        },
      ];
    }
    case 'SCENE_UPDATE': {
      gm();
      const parsed = sceneSchema.parse(m.scene),
        next = {
          ...parsed,
          tokens: Object.fromEntries(
            Object.entries(parsed.tokens).map(([id, t]) => {
              const size = Math.min(t.size, parsed.width, parsed.height);
              return [id, { ...t, size, ...clampPoint(t, parsed.width, parsed.height, size) }];
            }),
          ),
        };
      if (next.id === state.activeSceneId && next.visibility === 'gm')
        throw new Error('The active scene must remain visible.');
      next.zones = Object.fromEntries(
        Object.entries(parsed.zones).map(([id, zone]) => {
          const original = zone.anchorTokenId && parsed.tokens[zone.anchorTokenId];
          const clamped = zone.anchorTokenId && next.tokens[zone.anchorTokenId];
          return [
            id,
            original && clamped
              ? translateZone(zone, clamped.x - original.x, clamped.y - original.y)
              : zone,
          ];
        }),
      );
      assertAsset(room, next.map);
      for (const t of Object.values(next.tokens)) assertAsset(room, t.image);
      if (
        Object.keys(next.tokens).length > 100 ||
        Object.keys(next.zones).length > 100 ||
        Object.keys(next.pins || {}).length > 100 ||
        Object.keys(next.walls || {}).length > 256 ||
        Object.keys(next.annotations || {}).length > 100
      )
        throw new Error('Scene limit exceeded.');
      for (const [key, t] of Object.entries(next.tokens))
        if (key !== t.id) throw new Error('Token identifiers must match their keys.');
      for (const [key, pin] of Object.entries(next.pins || {}))
        if (key !== pin.id) throw new Error('Pin identifiers must match their keys.');
      for (const [key, wall] of Object.entries(next.walls || {}))
        if (key !== wall.id) throw new Error('Wall identifiers must match their keys.');
      if (!state.scenes[next.id] && Object.keys(state.scenes).length >= 10)
        throw new Error('A campaign supports up to ten scenes.');
      return [{ kind: 'scene', scene: next }];
    }
    case 'GRID_UPDATE':
      gm();
      scene(m.sceneId);
      return [{ kind: 'grid', sceneId: m.sceneId, grid: m.grid }];
    case 'PIN_SET': {
      gm();
      const s = scene(m.sceneId),
        old = s.pins?.[m.pin.id];
      if ((old && (!m.expected || pinDigest(old) !== m.expected)) || (!old && m.expected))
        throw new Error('Pin changed or was removed. Review it again.');
      if (!old && Object.keys(s.pins || {}).length >= 100)
        throw new Error('A scene supports up to 100 pins.');
      if (m.pin.x < 0 || m.pin.y < 0 || m.pin.x > s.width || m.pin.y > s.height)
        throw new Error('Pin must be inside the scene.');
      if (m.pin.destinationSceneId && !state.scenes[m.pin.destinationSceneId])
        throw new Error('Destination scene not found.');
      return [{ kind: 'pin', sceneId: s.id, pin: m.pin }];
    }
    case 'WALL_SET': {
      gm();
      const s = scene(m.sceneId);
      if (!s.walls?.[m.wall.id] && Object.keys(s.walls || {}).length >= 256)
        throw new Error('A scene supports up to 256 walls.');
      if ([m.wall.a, m.wall.b].some((p) => p.x < 0 || p.y < 0 || p.x > s.width || p.y > s.height))
        throw new Error('Wall endpoints must be inside the scene.');
      const old = s.walls?.[m.wall.id];
      if (
        old &&
        old.a.x === m.wall.a.x &&
        old.a.y === m.wall.a.y &&
        old.b.x === m.wall.b.x &&
        old.b.y === m.wall.b.y &&
        old.kind === m.wall.kind &&
        !!old.open === !!m.wall.open
      )
        return [];
      return [{ kind: 'wall', sceneId: s.id, wall: m.wall }];
    }
    case 'WALL_DELETE':
      gm();
      if (!scene(m.sceneId).walls?.[m.id]) return [];
      return [{ kind: 'wall-delete', sceneId: m.sceneId, id: m.id }];
    case 'LIGHTING_SET':
      gm();
      if (m.expected !== undefined) {
        const current = scene(m.sceneId).lighting ?? null;
        if (
          (current?.vision ?? null) !== (m.expected?.vision ?? null) ||
          (current?.darkness ?? null) !== (m.expected?.darkness ?? null)
        )
          throw new Error('Lighting changed while you were editing. Reload the latest settings.');
      }
      if (
        scene(m.sceneId).lighting?.vision === m.lighting.vision &&
        scene(m.sceneId).lighting?.darkness === m.lighting.darkness
      )
        return [];
      return [{ kind: 'lighting', sceneId: m.sceneId, lighting: m.lighting }];
    case 'PIN_DELETE':
      gm();
      scene(m.sceneId);
      return [{ kind: 'pin-delete', sceneId: m.sceneId, id: m.id }];
    case 'SCENE_VISIBILITY': {
      gm();
      const target = scene(m.sceneId);
      if (m.visibility === 'gm' && target.id === state.activeSceneId)
        throw new Error('The active scene must remain visible.');
      return [{ kind: 'scene', scene: { ...target, visibility: m.visibility } }];
    }
    case 'SCENE_CHANGE': {
      gm();
      const target = scene(m.sceneId);
      return [
        ...(target.visibility === 'gm'
          ? [{ kind: 'scene' as const, scene: { ...target, visibility: 'public' as const } }]
          : []),
        { kind: 'scene-active', sceneId: m.sceneId, transition: m.transition },
      ];
    }
    case 'FOG_UPDATE':
      gm();
      return [{ kind: 'scene', scene: { ...scene(m.sceneId), fog: m.fog } }];
    case 'FOG_APPEND': {
      gm();
      const s = scene(m.sceneId),
        operations = s.fog.operations || [];
      if (operations.length >= 500)
        throw new Error('Fog mask is full. Reset it or undo recent strokes.');
      return [{ kind: 'fog-operation', sceneId: s.id, operation: m.operation }];
    }
    case 'ZONE_UPDATE': {
      gm();
      const s = scene(m.sceneId);
      const current = s.zones[m.zone.id];
      if (current ? !m.expected || m.expected !== zoneDigest(current) : !!m.expected)
        throw new Error(
          'This region changed or was removed. Review the latest region before saving.',
        );
      if (m.zone.anchorTokenId && !s.tokens[m.zone.anchorTokenId])
        throw new Error('Choose an existing token for this region.');
      if (
        m.zone.duration &&
        !(state.tracker || emptyTracker()).entries.some(
          (e) => e.id === m.zone.duration!.participantId,
        )
      )
        throw new Error('Choose a participant in the turn tracker.');
      if (!s.zones[m.zone.id] && Object.keys(s.zones).length >= 100)
        throw new Error('Zone limit reached.');
      if (
        ['polygon', 'cone', 'line'].includes(m.zone.shape) &&
        (!m.zone.points || m.zone.points.length < (m.zone.shape === 'line' ? 2 : 3))
      )
        throw new Error('Zone geometry is incomplete.');
      return [{ kind: 'zone', sceneId: s.id, zone: m.zone }];
    }
    case 'ZONE_DELETE':
      gm();
      scene(m.sceneId);
      return [{ kind: 'zone-delete', sceneId: m.sceneId, id: m.id }];
    case 'ANNOTATION_UPDATE': {
      gm();
      const s = scene(m.sceneId);
      if (!s.annotations?.[m.annotation.id] && Object.keys(s.annotations || {}).length >= 100)
        throw new Error('Drawing limit reached.');
      return [{ kind: 'annotation', sceneId: s.id, annotation: m.annotation }];
    }
    case 'ANNOTATION_DELETE':
      gm();
      scene(m.sceneId);
      return [{ kind: 'annotation-delete', sceneId: m.sceneId, id: m.id }];
    case 'ANNOTATIONS_DELETE': {
      gm();
      const s = scene(m.sceneId);
      if (new Set(m.ids).size !== m.ids.length) throw new Error('Duplicate drawing identifiers.');
      return m.ids
        .filter((id) => s.annotations?.[id])
        .map((id) => ({ kind: 'annotation-delete', sceneId: s.id, id }));
    }
    case 'OBJECTS_DELETE': {
      gm();
      const s = scene(m.sceneId);
      if (!m.annotationIds.length && !m.zoneIds.length)
        throw new Error('Choose drawings or zones to erase.');
      if (
        new Set(m.annotationIds).size !== m.annotationIds.length ||
        new Set(m.zoneIds).size !== m.zoneIds.length
      )
        throw new Error('Duplicate object identifiers.');
      return [
        ...m.annotationIds
          .filter((id) => s.annotations?.[id])
          .map((id): StateChange => ({ kind: 'annotation-delete', sceneId: s.id, id })),
        ...m.zoneIds
          .filter((id) => s.zones[id])
          .map((id): StateChange => ({ kind: 'zone-delete', sceneId: s.id, id })),
      ];
    }
    case 'LIBRARY_SAVE':
      gm();
      assertAsset(room, m.token.image);
      if (!state.tokenLibrary?.[m.token.id] && Object.keys(state.tokenLibrary || {}).length >= 100)
        throw new Error('Library limit reached.');
      return [{ kind: 'library', id: m.token.id, token: m.token }];
    case 'LIBRARY_DELETE':
      gm();
      return [{ kind: 'library', id: m.id, token: null }];
    case 'ENCOUNTER_SAVE': {
      gm();
      const s = scene(m.sceneId);
      if (state.encounters?.[m.id]) throw new Error('Encounter already exists.');
      if (Object.keys(state.encounters || {}).length >= 50)
        throw new Error('Encounter limit reached.');
      if (new Set(m.tokenIds).size !== m.tokenIds.length)
        throw new Error('Duplicate tokens in encounter.');
      const selected = new Set(m.tokenIds);
      const entries = (state.tracker || emptyTracker()).entries.filter(
        (entry) => entry.tokenId && selected.has(entry.tokenId),
      );
      const anchors = new Set(entries.map((entry) => entry.id));
      const tokens = m.tokenIds.map((id) => {
        const token = s.tokens[id];
        if (!token) throw new Error('A selected token no longer exists.');
        return {
          ...token,
          statuses: token.statuses?.map((status) =>
            status.duration && !anchors.has(status.duration.participantId)
              ? { ...status, duration: undefined }
              : status,
          ),
        };
      });
      const characters = Object.fromEntries(
        tokens.flatMap((t) =>
          t.characterId && state.characters?.[t.characterId]
            ? [[t.characterId, state.characters[t.characterId]]]
            : [],
        ),
      );
      return [
        {
          kind: 'encounter',
          id: m.id,
          encounter: { id: m.id, name: m.name, tokens, entries, characters },
        },
      ];
    }
    case 'ENCOUNTER_DELETE':
      gm();
      return [{ kind: 'encounter', id: m.id, encounter: null }];
    case 'ENCOUNTER_REPAIR': {
      gm();
      const encounter = state.encounters?.[m.id];
      if (!encounter || encounterDigest(encounter) !== m.digest)
        throw new Error('Encounter changed or was removed. Review it again.');
      if (!encounter.tokens.some((token) => token.characterId === m.from))
        throw new Error('That character link is not in the encounter.');
      const sheet = m.to ? state.characters?.[m.to] : undefined;
      if (m.to && !sheet) throw new Error('Choose an existing character sheet.');
      const tokens = encounter.tokens.map((token) =>
        token.characterId !== m.from
          ? token
          : {
              ...token,
              characterId: m.to,
              resourceId:
                sheet && token.resourceId && sheet.resources.some((r) => r.id === token.resourceId)
                  ? token.resourceId
                  : null,
            },
      );
      const characters = { ...encounter.characters };
      delete characters[m.from];
      if (sheet) characters[sheet.id] = sheet;
      return [{ kind: 'encounter', id: m.id, encounter: { ...encounter, tokens, characters } }];
    }
    case 'ENCOUNTER_PLACE': {
      gm();
      const encounter = state.encounters?.[m.id],
        s = scene(m.sceneId),
        tracker = state.tracker || emptyTracker();
      if (!encounter) throw new Error('Encounter not found.');
      if (
        Object.keys(s.tokens).length + encounter.tokens.length > 100 ||
        tracker.entries.length + encounter.entries.length > 50
      )
        throw new Error('This encounter exceeds the scene or tracker limit.');
      const tokenIds = new Map(encounter.tokens.map((token) => [token.id, randomUUID()]));
      const entryIds = new Map(encounter.entries.map((entry) => [entry.id, randomUUID()]));
      const placementId = randomUUID();
      const groupIds = new Map<string, string>();
      const copies: CharacterSheet[] = [];
      const tokens = encounter.tokens.map((token): Token => {
        assertAsset(room, token.image);
        const source = token.characterId
          ? m.independent
            ? encounter.characters?.[token.characterId] || state.characters?.[token.characterId]
            : state.characters?.[token.characterId]
          : undefined;
        if (token.characterId && !source)
          throw new Error('An encounter character sheet was removed.');
        if (
          token.resourceId &&
          !source?.resources.some((resource) => resource.id === token.resourceId)
        )
          throw new Error('An encounter resource was removed.');
        let characterId = token.characterId;
        if (m.independent && source) {
          characterId = randomUUID();
          copies.push({ ...structuredClone(source), id: characterId, ownerId: user.id });
        }
        if (token.groupId && !groupIds.has(token.groupId))
          groupIds.set(token.groupId, randomUUID());
        return {
          ...token,
          id: tokenIds.get(token.id)!,
          encounterId: encounter.id,
          encounterTokenId: token.id,
          encounterPlacementId: placementId,
          characterId,
          groupId: token.groupId ? groupIds.get(token.groupId) : undefined,
          ...clampPoint(token, s.width, s.height, token.size),
          statuses: token.statuses?.map((status) => ({
            ...status,
            id: randomUUID(),
            duration:
              status.duration && entryIds.has(status.duration.participantId)
                ? {
                    ...status.duration,
                    participantId: entryIds.get(status.duration.participantId)!,
                  }
                : undefined,
          })),
        };
      });
      const allSheets = Object.values(state.characters || {});
      if (
        allSheets.length + copies.length > 50 ||
        allSheets.filter((sheet) => sheet.ownerId === user.id).length + copies.length > 20
      )
        throw new Error('Independent copies exceed the character limit.');
      const added = encounter.entries.map((entry) => ({
        ...entry,
        id: entryIds.get(entry.id)!,
        encounterEntryId: entry.id,
        encounterPlacementId: placementId,
        tokenId: entry.tokenId ? tokenIds.get(entry.tokenId) : undefined,
      }));
      const entries = [...tracker.entries, ...added];
      if (tracker.order !== 'manual')
        entries.sort((a, b) =>
          tracker.order === 'descending' ? b.value - a.value : a.value - b.value,
        );
      return [
        ...copies.map((sheet): StateChange => sheetChange(sheet)),
        ...tokens.map((token): StateChange => ({ kind: 'token', sceneId: s.id, token })),
        ...(added.length
          ? [
              {
                kind: 'tracker' as const,
                tracker: {
                  ...tracker,
                  entries,
                  activeId: tracker.activeId || entries[0]?.id || null,
                },
              },
            ]
          : []),
      ];
    }
    case 'ENCOUNTER_REFRESH': {
      gm();
      const encounter = state.encounters?.[m.id],
        s = scene(m.sceneId);
      if (!encounter) throw new Error('Encounter not found.');
      const placed = Object.values(s.tokens).filter(
        (t) => t.encounterId === m.id && t.encounterPlacementId === m.placementId,
      );
      if (!placed.length) throw new Error('Encounter placement not found.');
      const tracker = state.tracker || emptyTracker();
      const entryIds = new Map(
        tracker.entries
          .filter((e) => e.encounterPlacementId === m.placementId && e.encounterEntryId)
          .map((e) => [e.encounterEntryId!, e.id]),
      );
      const tokens = placed.map((token) => {
        const original = encounter.tokens.find((t) => t.id === token.encounterTokenId);
        if (!original) throw new Error('Encounter has changed. Place it again instead.');
        return {
          ...token,
          x: original.x,
          y: original.y,
          size: original.size,
          rotation: original.rotation,
          color: original.color,
          resource: original.resource,
          statuses: original.statuses?.map((status) => ({
            ...status,
            id: randomUUID(),
            duration:
              status.duration && entryIds.has(status.duration.participantId)
                ? {
                    ...status.duration,
                    participantId: entryIds.get(status.duration.participantId)!,
                  }
                : undefined,
          })),
        };
      });
      const entries = tracker.entries.map((entry) => {
        if (entry.encounterPlacementId !== m.placementId) return entry;
        const original = encounter.entries.find((e) => e.id === entry.encounterEntryId);
        return original
          ? { ...entry, name: original.name, value: original.value, hidden: original.hidden }
          : entry;
      });
      if (tracker.order !== 'manual')
        entries.sort((a, b) =>
          tracker.order === 'descending' ? b.value - a.value : a.value - b.value,
        );
      return [...update(s.id, tokens), { kind: 'tracker', tracker: { ...tracker, entries } }];
    }
    case 'TRACKER_UPDATE': {
      gm();
      const tracker = { ...m.tracker, entries: [...m.tracker.entries] };
      if (new Set(tracker.entries.map((e) => e.id)).size !== tracker.entries.length)
        throw new Error('Duplicate tracker participants.');
      if (tracker.entries.some((entry) => entry.id === REDACTED_TURN_ID))
        throw new Error('Reserved tracker identifier.');
      if (tracker.activeId && !tracker.entries.some((e) => e.id === tracker.activeId))
        throw new Error('Choose an existing participant.');
      const retained = new Set(tracker.entries.map((entry) => entry.id));
      for (const s of Object.values(state.scenes)) {
        if (
          Object.values(s.tokens).some((t) =>
            t.statuses?.some(
              (status) => status.duration && !retained.has(status.duration.participantId),
            ),
          ) ||
          Object.values(s.zones).some(
            (zone) => zone.duration && !retained.has(zone.duration.participantId),
          )
        )
          throw new Error('Remove or reassign effects timed to this participant first.');
      }
      if (tracker.order !== 'manual')
        tracker.entries.sort((a, b) =>
          tracker.order === 'descending' ? b.value - a.value : a.value - b.value,
        );
      return [{ kind: 'tracker', tracker }];
    }
    case 'TRACKER_ADVANCE': {
      gm();
      const tracker = state.tracker || emptyTracker(),
        entries = tracker.entries;
      if (!entries.length) throw new Error('Add a participant first.');
      const index = entries.findIndex((e) => e.id === tracker.activeId),
        next = index < 0 ? 0 : (index + m.direction + entries.length) % entries.length;
      const round = Math.min(
        10000,
        Math.max(
          1,
          tracker.round +
            (index >= 0 && m.direction === 1 && next === 0
              ? 1
              : index === 0 && m.direction === -1
                ? -1
                : 0),
        ),
      );
      const changes: StateChange[] = [
        { kind: 'tracker', tracker: { ...tracker, activeId: entries[next].id, round } },
      ];
      if (m.direction === 1 && index >= 0) {
        const tick = (
          duration:
            { remaining: number; participantId: string; phase: 'start' | 'end' } | undefined,
        ) => {
          if (
            !duration ||
            !(
              (duration.phase === 'end' && duration.participantId === entries[index].id) ||
              (duration.phase === 'start' && duration.participantId === entries[next].id)
            )
          )
            return duration;
          return duration.remaining === 1
            ? null
            : { ...duration, remaining: duration.remaining - 1 };
        };
        for (const s of Object.values(state.scenes)) {
          for (const t of Object.values(s.tokens)) {
            if (!t.statuses?.some((status) => tick(status.duration) !== status.duration)) continue;
            const statuses = t.statuses.flatMap((status) => {
              const duration = tick(status.duration);
              return duration === null ? [] : [{ ...status, duration }];
            });
            changes.push({ kind: 'token', sceneId: s.id, token: { ...t, statuses } });
          }
          for (const zone of Object.values(s.zones)) {
            const duration = tick(zone.duration);
            if (duration === zone.duration) continue;
            changes.push(
              duration === null
                ? { kind: 'zone-delete', sceneId: s.id, id: zone.id }
                : { kind: 'zone', sceneId: s.id, zone: { ...zone, duration } },
            );
          }
        }
      }
      return changes;
    }
    case 'DICE_ROLL_REQUEST':
      return [
        {
          kind: 'roll',
          roll: {
            ...evaluateDice(m.expression, randomInt),
            id: randomUUID(),
            actionId: m.actionId,
            userId: user.id,
            userName: user.name,
            expression: m.expression,
            visibility: m.visibility,
            createdAt: new Date().toISOString(),
          },
        },
      ];
    case 'STAT_ROLL_REQUEST': {
      const sheets = m.characterIds.map(character);
      if (sheets.some((sheet) => !Object.hasOwn(sheet.stats, m.stat)))
        throw new Error('Every selected character needs that stat.');
      const dice = parseDice(m.expression).reduce(
        (sum, term) => sum + (term.kind === 'dice' ? term.count : 0),
        0,
      );
      if (dice * sheets.length > 100) throw new Error('A group roll supports at most 100 dice.');
      const explosionBudget = { remaining: 20 };
      const results = sheets.map((sheet) => {
        const evaluated = evaluateDice(m.expression, randomInt, explosionBudget);
        const statValue = sheet.stats[m.stat];
        const modifiers = [
          {
            kind: 'modifier' as const,
            sign: (statValue < 0 ? -1 : 1) as 1 | -1,
            values: [Math.abs(statValue)],
            label: m.stat,
            subtotal: statValue,
          },
          {
            kind: 'modifier' as const,
            sign: (m.modifier < 0 ? -1 : 1) as 1 | -1,
            values: [Math.abs(m.modifier)],
            label: 'Adjustment',
            subtotal: m.modifier,
          },
        ];
        return {
          sheet,
          total: evaluated.total + statValue + m.modifier,
          terms: [...evaluated.terms, ...modifiers],
          contributions: [
            { label: m.expression, terms: evaluated.terms, total: evaluated.total },
            { label: m.stat, terms: [modifiers[0]], total: statValue },
            { label: 'adjustment', terms: [modifiers[1]], total: m.modifier },
          ],
        };
      });
      const groups = results.map((r, i) => ({
        name:
          results.filter((other) => other.sheet.name === r.sheet.name).length > 1
            ? `${r.sheet.name} ${i + 1}`
            : r.sheet.name,
        total: r.total,
        terms: r.terms,
        contributions: r.contributions,
      }));
      return [
        {
          kind: 'roll',
          roll: {
            id: randomUUID(),
            actionId: m.actionId,
            userId: user.id,
            userName: user.name,
            expression: `${results.length === 1 ? `${results[0].sheet.name} · ` : ''}${m.stat} · ${m.expression} ${m.modifier < 0 ? '−' : '+'} ${Math.abs(m.modifier)}`,
            terms: results.flatMap((r) => r.terms),
            total: results[0].total,
            ...(results.length > 1
              ? { macro: { name: `${m.stat} group roll`, variables: {}, groups } }
              : {}),
            visibility: m.visibility,
            createdAt: new Date().toISOString(),
          },
        },
      ];
    }
    default:
      throw new Error('Unsupported state action.');
  }
}
