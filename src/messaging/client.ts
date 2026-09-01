import { browser } from 'wxt/browser';
import { RuntimeResponseSchema, type RuntimeRequest } from './schema';

export const errorMessage = (value: unknown, fallback: string): string =>
  value instanceof Error ? value.message : fallback;

export async function sendExtensionRequest<T>(request: RuntimeRequest): Promise<T> {
  const rawResponse: unknown = await browser.runtime.sendMessage(request);
  const response = RuntimeResponseSchema.parse(rawResponse);
  if (!response.ok) {
    throw new Error(response.error || 'The extension request failed.');
  }
  return response.data as T;
}
