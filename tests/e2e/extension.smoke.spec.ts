import { expect, test, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import { coachingMapFixture } from '../fixtures/domain';

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
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'resp_e2e',
          object: 'response',
          status: 'completed',
          output: [
            {
              id: 'msg_e2e',
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify(coachingMapFixture),
                  annotations: [],
                },
              ],
            },
          ],
        }),
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
  } finally {
    await context?.close();
  }
});
