/**
 * Voice MCP tool: speak(text) → sends an audio message to the current conversation.
 *
 * TTS backend resolution (first available wins):
 *   1. TTS_URL env var — OpenAI-compatible /v1/audio/speech endpoint (Kokoro or real OpenAI)
 *   2. Google Translate TTS — unofficial, no key, chunked at 200 chars
 *
 * Set TTS_VOICE to change the voice (default: af_heart). Kokoro voices:
 *   af_heart, af_bella, af_nicole, am_adam, am_michael, bf_emma, bm_george
 *
 * The generated MP3 is staged in /workspace/outbox/ so delivery.ts picks it
 * up and sends it as an audio attachment (same path as send_file).
 */
import fs from 'fs';
import path from 'path';

import { writeMessageOut } from '../db/messages-out.js';
import { getSessionRouting } from '../db/session-routing.js';
import { registerTools } from './server.js';
import type { McpToolDefinition } from './types.js';

function log(msg: string): void {
  console.error(`[mcp-tools/voice] ${msg}`);
}

function generateId(): string {
  return `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Split text into ≤maxLen char chunks on word boundaries. */
function chunkText(text: string, maxLen = 200): string[] {
  const chunks: string[] = [];
  const words = text.split(' ');
  let current = '';
  for (const word of words) {
    if (current.length + word.length + 1 > maxLen) {
      if (current) chunks.push(current.trim());
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function synthesize(text: string): Promise<Buffer | null> {
  // Option 1: OpenAI-compatible TTS endpoint (Kokoro local sidecar or real OpenAI)
  const ttsUrl = process.env.TTS_URL;
  if (ttsUrl) {
    try {
      const res = await fetch(ttsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.TTS_MODEL ?? 'kokoro',
          voice: process.env.TTS_VOICE ?? 'af_heart',
          input: text.slice(0, 4096),
          response_format: 'mp3',
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      log(`TTS endpoint returned ${res.status}, falling back to Google TTS`);
    } catch (err) {
      log(`TTS endpoint failed, falling back to Google TTS: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Option 2: Google Translate TTS (unofficial, no API key required)
  // MP3 frames are self-contained so concatenating buffers produces a valid file.
  const chunks = chunkText(text.slice(0, 2000));
  const parts: Buffer[] = [];
  for (const chunk of chunks) {
    const url =
      `https://translate.google.com/translate_tts` +
      `?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=en&client=tw-ob`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    parts.push(Buffer.from(await res.arrayBuffer()));
  }
  return parts.length > 0 ? Buffer.concat(parts) : null;
}

export const speak: McpToolDefinition = {
  tool: {
    name: 'speak',
    description:
      'Send a voice message. Converts text to speech and delivers it as an audio file to the current conversation.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string', description: 'Text to speak (max ~2000 chars)' },
      },
      required: ['text'],
    },
  },
  async handler(args) {
    const text = (args.text as string)?.trim();
    if (!text) return { content: [{ type: 'text' as const, text: 'Error: text is required' }], isError: true };

    const session = getSessionRouting();
    if (!session.channel_type || !session.platform_id) {
      return { content: [{ type: 'text' as const, text: 'Error: no active session routing' }], isError: true };
    }

    let audio: Buffer | null = null;
    try {
      audio = await synthesize(text);
    } catch (err) {
      log(`TTS synthesis error: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!audio) {
      return { content: [{ type: 'text' as const, text: 'Error: TTS synthesis failed' }], isError: true };
    }

    const id = generateId();
    const filename = `voice_${Date.now()}.mp3`;
    const outboxDir = path.join('/workspace/outbox', id);
    fs.mkdirSync(outboxDir, { recursive: true });
    fs.writeFileSync(path.join(outboxDir, filename), audio);

    writeMessageOut({
      id,
      kind: 'chat',
      platform_id: session.platform_id,
      channel_type: session.channel_type,
      thread_id: session.thread_id,
      content: JSON.stringify({ text: '', files: [filename] }),
    });

    log(`speak → ${session.channel_type}:${session.platform_id} (${filename}, ${audio.length} bytes)`);
    return { content: [{ type: 'text' as const, text: `Voice message sent (${filename})` }] };
  },
};

registerTools([speak]);
