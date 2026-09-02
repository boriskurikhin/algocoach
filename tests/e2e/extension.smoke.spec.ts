import { expect, test, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import { problemAnalysisFixture } from '../fixtures/domain';

test('loads the packaged settings and side-panel surfaces', async () => {
  test.setTimeout(70_000);
  const extensionPath = path.resolve('.output/chrome-mv3');
  let context: BrowserContext | undefined;

  try {
    context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });

    let [serviceWorker] = context.serviceWorkers();
    serviceWorker ??= await context.waitForEvent('serviceworker');
    const extensionId = new URL(serviceWorker.url()).host;
    expect(
      await serviceWorker.evaluate(
        'chrome.runtime.getManifest().options_ui?.open_in_tab',
      ),
    ).toBe(true);

    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(options.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(options.getByRole('heading', { name: 'OpenAI' })).toBeVisible();
    await expect(
      options.getByRole('heading', { name: 'Learner memory' }),
    ).toBeVisible();

    const sidePanel = await context.newPage();
    await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(sidePanel.getByRole('heading', { name: 'Algo Coach' })).toBeVisible();
    await expect(sidePanel.getByText(/protects productive struggle/i)).toBeVisible();

    await serviceWorker.evaluate(`
      chrome.storage.local.set({
        'socratic-coach:settings': {
          apiKey: 'sk-e2e-placeholder',
          model: 'gpt-5.6-sol',
          reasoningEffort: 'high',
          reasoningMode: 'standard'
        }
      })
    `);
    await context.route('https://api.openai.com/v1/responses', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 31_000));
      const response = {
        id: 'resp_e2e',
        object: 'response',
        status: 'completed',
        usage: {
          input_tokens: 1_000,
          input_tokens_details: {
            cached_tokens: 0,
            cache_write_tokens: 0,
          },
          output_tokens: 300,
          output_tokens_details: { reasoning_tokens: 200 },
          total_tokens: 1_300,
        },
        output: [
          {
            id: 'msg_e2e',
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify(problemAnalysisFixture),
                annotations: [],
              },
            ],
          },
        ],
      };
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body:
          [
            {
              type: 'response.created',
              sequence_number: 0,
              response: { ...response, status: 'in_progress', output: [] },
            },
            { type: 'response.completed', sequence_number: 1, response },
          ]
            .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
            .join('') + 'data: [DONE]\n\n',
      });
    });

    await sidePanel.reload();
    const manualEntry = sidePanel.locator('details.manual-entry');
    if ((await manualEntry.getAttribute('open')) === null) {
      await manualEntry.getByText('Paste a problem instead').click();
    }
    await manualEntry.getByLabel(/^Title/).fill('Delayed test problem');
    await manualEntry
      .getByLabel('Problem statement')
      .fill(
        'Given a list of integers, determine whether its sum is even. ' +
          'The input contains the list and the output is YES or NO. '.repeat(3),
      );
    await manualEntry.getByRole('button', { name: 'Study pasted problem' }).click();
    await expect(sidePanel.getByText(/I’ve read “Delayed test problem.”/)).toBeVisible({
      timeout: 40_000,
    });
    await expect(sidePanel.getByText(/1\.3K tokens · ≈\$0\.010/)).toBeVisible();

    await sidePanel.setViewportSize({ width: 420, height: 320 });
    const brandHeader = sidePanel.locator('.panel-header');
    const sessionHeader = sidePanel.locator('.session-heading');
    const sessionSurface = sessionHeader.locator('.session-heading-surface');
    const mascot = brandHeader.locator('.coach-mascot');
    await sidePanel.evaluate(() => window.scrollTo(0, 0));
    await expect
      .poll(async () => {
        const brandBox = await brandHeader.boundingBox();
        const sessionBox = await sessionHeader.boundingBox();
        if (!brandBox || !sessionBox) return Number.POSITIVE_INFINITY;
        return Math.abs(sessionBox.y - (brandBox.y + brandBox.height));
      })
      .toBeLessThanOrEqual(1);
    await expect
      .poll(() =>
        sessionSurface.evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).paddingLeft),
        ),
      )
      .toBe(0);
    await expect
      .poll(() =>
        sessionSurface.evaluate(
          (element) => getComputedStyle(element).boxShadow !== 'none',
        ),
      )
      .toBe(true);

    await sidePanel.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect
      .poll(async () => Math.round((await sessionHeader.boundingBox())?.y ?? -1))
      .toBe(0);
    await expect
      .poll(() =>
        sessionSurface.evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).paddingLeft),
        ),
      )
      .toBeGreaterThan(0);
    await expect(brandHeader).toHaveCSS('border-bottom-color', 'rgba(0, 0, 0, 0)');
    await expect(sessionSurface).toHaveCSS('box-shadow', 'none');
    await expect(
      sessionHeader.getByRole('heading', { name: 'Delayed test problem' }),
    ).toBeVisible();
    await expect(sessionHeader.getByText('CF ≈1300')).toBeVisible();
    await expect(
      sessionHeader.getByRole('button', { name: 'Change problem' }),
    ).toBeVisible();
    await expect(mascot).toBeVisible();
    await expect
      .poll(() =>
        sidePanel.evaluate(() => {
          const session = document.querySelector('.session-heading');
          const brandTitle = document.querySelector('.panel-header h1');
          if (!session || !brandTitle) return false;
          const rect = brandTitle.getBoundingClientRect();
          const topElement = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          return Boolean(topElement && session.contains(topElement));
        }),
      )
      .toBe(true);

    await sidePanel.evaluate(() => window.scrollTo(0, 0));
    await expect
      .poll(async () => {
        const brandBox = await brandHeader.boundingBox();
        const sessionBox = await sessionHeader.boundingBox();
        if (!brandBox || !sessionBox) return Number.POSITIVE_INFINITY;
        return Math.abs(sessionBox.y - (brandBox.y + brandBox.height));
      })
      .toBeLessThanOrEqual(1);
    await expect
      .poll(() =>
        sessionSurface.evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).paddingLeft),
        ),
      )
      .toBe(0);
    await expect(
      brandHeader.getByRole('heading', { name: 'Algo Coach' }),
    ).toBeVisible();
    await expect(brandHeader.getByRole('button', { name: 'Settings' })).toBeVisible();
    await expect(mascot).toBeVisible();
  } finally {
    await context?.close();
  }
});
