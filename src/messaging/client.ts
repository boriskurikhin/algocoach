import { browser } from 'wxt/browser';
import {
  RuntimeResponseSchema,
  RuntimeResultSchemas,
  type RuntimeRequest,
  type RuntimeResult,
} from './schema';

export const errorMessage = (value: unknown, fallback: string): string =>
  value instanceof Error ? value.message : fallback;

export async function sendExtensionRequest<Request extends RuntimeRequest>(
  request: Request,
): Promise<RuntimeResult<Request['type']>> {
  const rawResponse: unknown = await browser.runtime.sendMessage(request);
  const parsedResponse = RuntimeResponseSchema.safeParse(rawResponse);
  if (!parsedResponse.success) {
    throw new Error('The extension returned an invalid response.');
  }
  const response = parsedResponse.data;
  if (!response.ok) {
    throw new Error(response.error);
  }
  const result = RuntimeResultSchemas[request.type].safeParse(response.data);
  if (!result.success) {
    throw new Error('The extension returned an invalid response.');
  }
  // TypeScript loses the request/schema correlation at the indexed lookup;
  // safeParse establishes it at runtime.
  return result.data as RuntimeResult<Request['type']>;
}
