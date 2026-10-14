import { expect, test } from '@playwright/test';

// Real physics/rendering runs in its own browser worker. Ordinary UI tests do
// not need to force the entire compositor through software OpenGL.
test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
  },
});

test('physical dice show predetermined d20, mixed polyhedra, and percentile faces', async ({
  page,
}) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const element = document.createElement('div');
    element.id = 'physics-test';
    Object.assign(element.style, {
      position: 'fixed',
      width: '800px',
      height: '550px',
      top: '0',
      left: '0',
      zIndex: '100',
    });
    document.body.appendChild(element);
    // Test the actual renderer installed by the app, rather than a mocked animation.
    const modulePath = '/src/diceEngine.ts';
    const { createDiceEngine } = await import(modulePath);
    const box = createDiceEngine('#physics-test', {
      baseScale: 65,
      iterationLimit: 400,
      theme_customColorset: {
        name: 'test',
        foreground: '#fff1d1',
        background: '#52694d',
        texture: 'none',
        material: 'metal',
      },
    });
    await box.initialize();
    const results = [];
    for (const notation of [
      '1d20@14',
      '1d4+1d6+1d8+1d10+1d12+1d20@3,5,7,8,11,19',
      '4d4@1,2,3,4',
      '1d100+1d10@60,7',
      '1d100+1d10@100,10',
    ]) {
      const rolled = await box.roll(notation);
      results.push(
        rolled.sets.flatMap((s: { rolls: Array<{ value: number }> }) =>
          s.rolls.map((r) => r.value),
        ),
      );
    }
    box.running = false;
    box.renderer.dispose();
    box.renderer.forceContextLoss();
    element.remove();
    return results;
  });
  expect(results).toEqual([[14], [3, 5, 7, 8, 11, 19], [1, 2, 3, 4], [60, 7], [100, 10]]);
});

test('custom tosses, slower/faster physics and transparent gemstone d4s retain forced faces', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const path = '/src/diceEngine.ts',
      themes = '/shared/diceThemes.ts';
    const { createDiceEngine } = await import(path),
      { dicePreferencesSchema } = await import(themes);
    const element = document.createElement('div');
    element.id = 'custom-physics';
    Object.assign(element.style, {
      position: 'fixed',
      width: '700px',
      height: '450px',
      top: '0',
      left: '0',
    });
    document.body.appendChild(element);
    const results = [];
    for (const [toss, speed] of [
      ['cascade', 0.5],
      ['orbit', 2],
    ]) {
      const appearance = dicePreferencesSchema.parse({
        toss,
        speed,
        opacity: 0.55,
        material: 'gemstone',
        performance: toss === 'orbit' ? 'cinematic' : 'low',
      });
      const box = createDiceEngine(
        '#custom-physics',
        {
          baseScale: 65,
          iterationLimit: 600,
          shadows: toss === 'orbit',
          sounds: false,
          theme_customColorset: {
            name: 'gemstone',
            foreground: '#ffffff',
            background: '#506ea8',
            texture: 'none',
            material: 'glass',
          },
        },
        appearance,
      );
      await box.initialize();
      const roll = await box.roll('1d4+1d6+1d20@4,6,20');
      results.push({
        values: roll.sets.flatMap((s: { rolls: Array<{ value: number }> }) =>
          s.rolls.map((r) => r.value),
        ),
        opacity: box.diceList[0].material[0].opacity,
        shadowResolution: box.light.shadow.map?.width || 0,
      });
      box.running = false;
      box.renderer.dispose();
      box.renderer.forceContextLoss();
      element.replaceChildren();
    }
    element.remove();
    return results;
  });
  expect(results).toEqual([
    { values: [4, 6, 20], opacity: 0.55, shadowResolution: 0 },
    { values: [4, 6, 20], opacity: 0.55, shadowResolution: 2048 },
  ]);
});
