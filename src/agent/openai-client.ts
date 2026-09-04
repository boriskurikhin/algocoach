import OpenAI from 'openai';
import {
  ContentFilterFinishReasonError,
  LengthFinishReasonError,
} from 'openai/core/error';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { PAGE_ACCESS_DENIED_MESSAGE } from '../extraction/schema';
import type { ExtensionSettings } from '../storage/local';
import type { CoachModel, ModelReasoningEffort } from './models';
import { COACH_PROCESSING_TIER, OPENAI_CONNECTION_TIMEOUT_MS } from './schemas';

type ResponseBody = Parameters<OpenAI['responses']['stream']>[0];

class CoachRequestError extends Error {}

const OUTPUT_BUDGET_ERROR =
  'The coach could not finish this step. Try again; hard problems can vary between runs.';
const CONTENT_FILTER_ERROR =
  'A safety filter stopped this request. Try a shorter problem statement.';

export function createOpenAIClient(settings: ExtensionSettings): OpenAI {
  if (!settings.apiKey) {
    throw new Error('Add an API key in Settings before starting.');
  }

  return new OpenAI({
    apiKey: settings.apiKey,
    dangerouslyAllowBrowser: true,
    maxRetries: 0,
    timeout: OPENAI_CONNECTION_TIMEOUT_MS,
  });
}

/**
 * Apply the routed model and effort, standard processing, and no response
 * storage after the task body so it cannot override those controls.
 */
export async function requestModelResponse<Body extends ResponseBody>(
  settings: ExtensionSettings,
  body: Body,
  options: {
    signal?: AbortSignal | undefined;
    model: CoachModel;
    reasoningEffort: ModelReasoningEffort;
    promptCacheKey?: string | undefined;
  },
) {
  const { model } = options;
  const stream = createOpenAIClient(settings).responses.stream(
    {
      ...body,
      model,
      reasoning: {
        effort: options.reasoningEffort,
        mode: 'standard',
      },
      service_tier: COACH_PROCESSING_TIER,
      ...(options.promptCacheKey
        ? {
            prompt_cache_key: options.promptCacheKey,
            prompt_cache_options: { mode: 'implicit' as const, ttl: '30m' as const },
          }
        : {}),
      store: false,
    },
    { signal: options.signal },
  );
  // The SDK timeout covers opening the streaming response. Once OpenAI has
  // accepted the request, let hard reasoning finish; the caller's signal is
  // the explicit cancellation path.
  const response = await stream.finalResponse();

  if (response.status === 'failed') {
    throw new CoachRequestError('The coach could not complete this step. Try again.');
  }
  if (response.status === 'incomplete') {
    const message =
      response.incomplete_details?.reason === 'content_filter'
        ? CONTENT_FILTER_ERROR
        : OUTPUT_BUDGET_ERROR;
    throw new CoachRequestError(message);
  }
  return response;
}

export async function requestStructuredResponse<Schema extends z.ZodType>(input: {
  settings: ExtensionSettings;
  instructions: string;
  prompt: string;
  schema: Schema;
  schemaName: string;
  maxOutputTokens: number;
  invalidResultMessage: string;
  signal?: AbortSignal | undefined;
  model: CoachModel;
  reasoningEffort: ModelReasoningEffort;
  promptCacheKey?: string | undefined;
}): Promise<z.infer<Schema>> {
  const response = await requestModelResponse(
    input.settings,
    {
      instructions: input.instructions,
      input: input.prompt,
      text: {
        format: zodTextFormat(input.schema, input.schemaName),
        verbosity: 'low',
      },
      max_output_tokens: input.maxOutputTokens,
    },
    {
      signal: input.signal,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      promptCacheKey: input.promptCacheKey,
    },
  );

  if (!response.output_parsed) throw new CoachRequestError(input.invalidResultMessage);
  return input.schema.parse(response.output_parsed);
}

export function safeOpenAIError(error: unknown): string {
  if (error instanceof CoachRequestError) return error.message;
  if (error instanceof OpenAI.AuthenticationError) {
    return 'The API key was rejected. Check it in Settings.';
  }
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return 'The connection closed before the response finished. Try again.';
  }
  if (error instanceof OpenAI.RateLimitError) {
    return 'The coaching service is busy. Wait briefly and try again.';
  }
  if (error instanceof OpenAI.PermissionDeniedError) {
    return 'This API key lacks the required access.';
  }
  if (error instanceof OpenAI.NotFoundError) {
    return 'The coaching service is not available to this API key.';
  }
  if (
    error instanceof OpenAI.BadRequestError ||
    error instanceof OpenAI.UnprocessableEntityError
  ) {
    return 'The coaching service rejected this request. Try again.';
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return 'The extension could not reach the coaching service.';
  }
  if (error instanceof LengthFinishReasonError) {
    return OUTPUT_BUDGET_ERROR;
  }
  if (error instanceof ContentFilterFinishReasonError) {
    return CONTENT_FILTER_ERROR;
  }
  if (error instanceof OpenAI.APIError) {
    return error.status && error.status >= 500
      ? 'The coaching service had a temporary error. Try again.'
      : `The coaching service rejected the request (${error.status ?? 'no status'}).`;
  }
  if (error instanceof z.ZodError) {
    return 'The coach received an unreadable response. Try again.';
  }
  if (error instanceof OpenAI.OpenAIError) {
    return 'The response ended before the coach could read it. Try again.';
  }
  if (error instanceof Error) {
    const safeMessages = [
      'Add an API key',
      'No active webpage',
      'Chrome does not allow',
      PAGE_ACCESS_DENIED_MESSAGE,
      'The page did not yield',
      'This coaching session expired',
    ];
    if (safeMessages.some((prefix) => error.message.startsWith(prefix))) {
      return error.message;
    }
  }
  return 'The coach hit an internal error. Reload the extension and try again.';
}
