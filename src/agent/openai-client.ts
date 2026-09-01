import OpenAI from 'openai';
import {
  ContentFilterFinishReasonError,
  LengthFinishReasonError,
} from 'openai/core/error';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import type { ExtensionSettings } from '../storage/local';
import {
  COACH_PROCESSING_TIER,
  COACH_STEP_TIMEOUT_MINUTES,
  COACH_STEP_TIMEOUT_MS,
} from './schemas';
import { summarizeResponseUsage, type SessionUsage } from './usage';

type ResponseBody = Parameters<OpenAI['responses']['stream']>[0];

class CoachRequestError extends Error {}

const OUTPUT_BUDGET_ERROR =
  'OpenAI reached this step’s reasoning/output budget before finishing. Try again; hard problems can vary between runs.';
const MODEL_STEP_TIMEOUT_ERROR =
  `OpenAI did not finish this step within ${COACH_STEP_TIMEOUT_MINUTES} minutes. ` +
  'Try the request again.';
const CONTENT_FILTER_ERROR =
  'OpenAI’s safety filter stopped this request. Try a shorter problem statement.';

export function createOpenAIClient(settings: ExtensionSettings): OpenAI {
  if (!settings.apiKey) {
    throw new Error('Add an OpenAI API key in Settings before starting.');
  }

  return new OpenAI({
    apiKey: settings.apiKey,
    dangerouslyAllowBrowser: true,
    maxRetries: 0,
    timeout: COACH_STEP_TIMEOUT_MS,
  });
}

/**
 * Every coaching call shares one model, the learner's reasoning settings,
 * standard processing, and no response storage. Those are applied last so a
 * caller cannot opt out.
 */
export async function requestModelResponse<Body extends ResponseBody>(
  settings: ExtensionSettings,
  onActivity: (() => void) | undefined,
  body: Body,
  options: {
    signal?: AbortSignal | undefined;
    reasoningMode?: ExtensionSettings['reasoningMode'] | undefined;
    onUsage?: ((usage: SessionUsage) => void) | undefined;
    promptCacheKey?: string | undefined;
  } = {},
) {
  onActivity?.();
  const stream = createOpenAIClient(settings).responses.stream(
    {
      ...body,
      model: settings.model,
      reasoning: {
        effort: settings.reasoningEffort,
        mode: options.reasoningMode ?? settings.reasoningMode,
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
  stream.on('event', () => onActivity?.());
  // The SDK timeout stops waiting for response headers, but a streaming body can
  // continue afterward. Abort the stream explicitly to enforce a true wall clock.
  let deadlineReached = false;
  const deadline = setTimeout(() => {
    deadlineReached = true;
    stream.abort();
  }, COACH_STEP_TIMEOUT_MS);
  let response: Awaited<ReturnType<typeof stream.finalResponse>>;
  try {
    response = await stream.finalResponse();
  } catch (error) {
    if (deadlineReached) throw new CoachRequestError(MODEL_STEP_TIMEOUT_ERROR);
    throw error;
  } finally {
    clearTimeout(deadline);
  }
  onActivity?.();
  if (response.usage) options.onUsage?.(summarizeResponseUsage(response.usage));

  if (response.status === 'failed') {
    throw new CoachRequestError(
      'OpenAI could not complete this step. Try the request again.',
    );
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
  onActivity?: (() => void) | undefined;
  instructions: string;
  prompt: string;
  schema: Schema;
  schemaName: string;
  maxOutputTokens: number;
  invalidResultMessage: string;
  signal?: AbortSignal | undefined;
  reasoningMode?: ExtensionSettings['reasoningMode'] | undefined;
  onUsage?: ((usage: SessionUsage) => void) | undefined;
  promptCacheKey?: string | undefined;
}): Promise<z.infer<Schema>> {
  const response = await requestModelResponse(
    input.settings,
    input.onActivity,
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
      reasoningMode: input.reasoningMode,
      onUsage: input.onUsage,
      promptCacheKey: input.promptCacheKey,
    },
  );

  if (!response.output_parsed) throw new CoachRequestError(input.invalidResultMessage);
  return input.schema.parse(response.output_parsed);
}

export function safeOpenAIError(error: unknown): string {
  if (error instanceof CoachRequestError) return error.message;
  if (error instanceof OpenAI.AuthenticationError) {
    return 'OpenAI rejected this API key. Check it in Settings.';
  }
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return 'The connection to OpenAI closed before the response finished. Try again.';
  }
  if (error instanceof OpenAI.RateLimitError) {
    return 'OpenAI rate-limited the request. Wait briefly and try again.';
  }
  if (error instanceof OpenAI.PermissionDeniedError) {
    return 'This API key cannot use the configured model. Check its model access.';
  }
  if (error instanceof OpenAI.NotFoundError) {
    return 'The configured OpenAI model is not available to this API key.';
  }
  if (
    error instanceof OpenAI.BadRequestError ||
    error instanceof OpenAI.UnprocessableEntityError
  ) {
    return 'OpenAI rejected the request. Check the model and reasoning settings.';
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return 'The extension could not reach OpenAI.';
  }
  if (error instanceof LengthFinishReasonError) {
    return OUTPUT_BUDGET_ERROR;
  }
  if (error instanceof ContentFilterFinishReasonError) {
    return CONTENT_FILTER_ERROR;
  }
  if (error instanceof OpenAI.APIError) {
    return error.status && error.status >= 500
      ? 'OpenAI had a temporary server error. Try the request again.'
      : `OpenAI rejected the request (${error.status ?? 'no status'}).`;
  }
  if (error instanceof z.ZodError) {
    return 'OpenAI returned a response the coach could not read. Try the request again.';
  }
  if (error instanceof OpenAI.OpenAIError) {
    return 'OpenAI ended the response before the coach could read it. Try the request again.';
  }
  if (error instanceof Error) {
    const safeMessages = [
      'Add an OpenAI API key',
      'No active webpage',
      'Chrome does not allow',
      'Page access was not granted',
      'The page did not yield',
      'This coaching session expired',
    ];
    if (safeMessages.some((prefix) => error.message.startsWith(prefix))) {
      return error.message;
    }
  }
  return 'The coach hit an internal error. Reload the extension and try again.';
}
