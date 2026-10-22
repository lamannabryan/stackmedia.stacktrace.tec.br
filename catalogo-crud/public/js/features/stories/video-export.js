import { ArrayBufferTarget, Muxer } from '../../vendor/mp4-muxer-5.2.2.js';

export const STORY_VIDEO_DURATION = 15;
export const STORY_VIDEO_FPS = 30;

const VIDEO_WIDTH = 1080;
const VIDEO_HEIGHT = 1920;
const FRAME_COUNT = STORY_VIDEO_DURATION * STORY_VIDEO_FPS;
const MAX_QUEUED_FRAMES = 4;
const ENCODER_TIMEOUT_MS = 30000;
// WebKit may round a canvas VideoFrame timestamp by one microsecond when
// converting through seconds. Normalize only that rounding, never missing or
// reordered frames: https://bugs.webkit.org/show_bug.cgi?id=321880
const TIMESTAMP_ROUNDING_TOLERANCE_US = 1;
const DIMENSIONS_MESSAGE = 'Use um canvas de 1080 × 1920 (Stories), 1080 × 1350 (Feed) ou 1920 × 1080 (Indoor TV) pixels.';
const UNSUPPORTED_MESSAGE = 'Este navegador não oferece exportação MP4 em H.264. Abra o editor em uma versão atual do Chrome ou Edge com suporte a H.264.';

function abortError() {
  return new DOMException('Exportação do vídeo cancelada.', 'AbortError');
}

function checkAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function timestampForFrame(frameIndex) {
  return Math.round(frameIndex * 1_000_000 / STORY_VIDEO_FPS);
}

function supportsDimensions(width, height) {
  return (width === VIDEO_WIDTH && [VIDEO_HEIGHT, 1350].includes(height))
    || (width === 1920 && height === 1080);
}

/** Checks the actual H.264 encoder at the artwork's output resolution. */
export async function getStoryVideoConfig({ signal, width = VIDEO_WIDTH, height = VIDEO_HEIGHT } = {}) {
  checkAborted(signal);
  if (!supportsDimensions(width, height)) {
    throw new Error(DIMENSIONS_MESSAGE);
  }
  if (globalThis.isSecureContext === false) {
    throw new Error('Para exportar MP4, abra o editor por HTTPS ou em localhost. O navegador bloqueia a codificação de vídeo em conexões HTTP comuns.');
  }
  if (typeof globalThis.VideoEncoder !== 'function'
      || typeof globalThis.VideoEncoder.isConfigSupported !== 'function'
      || typeof globalThis.VideoFrame !== 'function') {
    throw new Error(UNSUPPORTED_MESSAGE);
  }

  // Level 4 supports the 8,160 macroblocks required by 1080 × 1920 at 30 fps.
  // Baseline excludes B-frames, keeping decode and presentation order equal.
  // Quality mode must preserve every frame; realtime mode may drop frames.
  for (const codec of ['avc1.420028', 'avc1.42e028']) {
    const config = {
      codec,
      width,
      height,
      framerate: STORY_VIDEO_FPS,
      bitrate: 8_000_000,
      latencyMode: 'quality',
      hardwareAcceleration: 'no-preference',
      avc: { format: 'avc' },
    };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      checkAborted(signal);
      if (support.supported) return config;
    } catch (error) {
      checkAborted(signal);
      // An unavailable profile may reject instead of returning supported: false.
    }
  }
  throw new Error(UNSUPPORTED_MESSAGE);
}

/**
 * Encode 450 explicitly timed frames as a real MP4/H.264 file, without audio.
 * renderFrame(seconds) paints the supplied Stories, Feed or Indoor TV canvas and may be async.
 * onProgress receives a fraction between 0 and 1; 1 means the MP4 is finalized.
 * The caller owns the canvas and any images/object URLs used while rendering.
 */
export async function exportStoryVideo({ canvas, renderFrame, onProgress = () => {}, signal }) {
  checkAborted(signal);
  if (!canvas || !supportsDimensions(canvas.width, canvas.height)) {
    throw new Error(DIMENSIONS_MESSAGE);
  }
  if (typeof renderFrame !== 'function' || typeof onProgress !== 'function') {
    throw new TypeError('Informe as funções de renderização e progresso do vídeo.');
  }
  const { width, height } = canvas;
  const config = await getStoryVideoConfig({ signal, width, height });
  checkAborted(signal);

  const target = new ArrayBufferTarget();
  let muxer = new Muxer({
    target,
    video: { codec: 'avc', width, height, frameRate: STORY_VIDEO_FPS },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'strict',
  });
  let encoder;
  let failure;
  let encodedFrames = 0;
  let rejectInterrupted;
  const interrupted = new Promise((resolve, reject) => { rejectInterrupted = reject; });
  // The encoder can fail between awaited operations; attach a handler immediately.
  interrupted.catch(() => {});

  const closeEncoder = () => {
    if (encoder && encoder.state !== 'closed') encoder.close();
  };
  const fail = (error) => {
    if (failure) return;
    failure = error;
    rejectInterrupted(error);
    closeEncoder();
  };
  const onAbort = () => fail(abortError());
  const checkState = () => {
    checkAborted(signal);
    if (failure) throw failure;
  };
  const waitForEncoder = async (operation) => {
    let timeout;
    try {
      await Promise.race([
        operation,
        interrupted,
        new Promise((resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('O codificador de vídeo parou de responder. Tente exportar novamente.')), ENCODER_TIMEOUT_MS);
        }),
      ]);
      checkState();
    } finally {
      clearTimeout(timeout);
    }
  };
  const waitForQueue = async () => {
    if (encoder.encodeQueueSize < MAX_QUEUED_FRAMES) return;
    let onDequeue;
    try {
      await waitForEncoder(new Promise((resolve) => {
        onDequeue = () => {
          if (encoder.encodeQueueSize < MAX_QUEUED_FRAMES) resolve();
        };
        encoder.addEventListener('dequeue', onDequeue);
        onDequeue();
      }));
    } finally {
      encoder.removeEventListener('dequeue', onDequeue);
    }
  };

  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    checkState();
    encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        if (failure || !muxer) return;
        try {
          const frameIndex = Math.round(chunk.timestamp * STORY_VIDEO_FPS / 1_000_000);
          const timestamp = timestampForFrame(frameIndex);
          if (frameIndex !== encodedFrames
              || Math.abs(chunk.timestamp - timestamp) > TIMESTAMP_ROUNDING_TOLERANCE_US) {
            throw new Error('O codificador não preservou a sequência de quadros da arte.');
          }
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          // Use our duration even if an encoder omits chunk.duration. Rounding
          // adjacent timestamps separately prevents drift at 30 frames/second.
          muxer.addVideoChunkRaw(data, chunk.type, timestamp,
            timestampForFrame(frameIndex + 1) - timestamp, metadata);
          encodedFrames += 1;
        } catch (error) {
          fail(error);
        }
      },
      error: (error) => fail(new Error('Não foi possível codificar o MP4 neste dispositivo. Tente novamente no Chrome ou Edge com suporte a H.264.', { cause: error })),
    });
    encoder.configure(config);
    onProgress(0);

    for (let frameIndex = 0; frameIndex < FRAME_COUNT; frameIndex += 1) {
      checkState();
      await Promise.race([Promise.resolve(renderFrame(frameIndex / STORY_VIDEO_FPS)), interrupted]);
      checkState();
      const timestamp = timestampForFrame(frameIndex);
      const frame = new VideoFrame(canvas, {
        timestamp,
        duration: timestampForFrame(frameIndex + 1) - timestamp,
        alpha: 'discard',
      });
      try {
        encoder.encode(frame, { keyFrame: frameIndex % (STORY_VIDEO_FPS * 2) === 0 });
      } finally {
        frame.close();
      }
      await waitForQueue();
      // Periodically drain the encoder's internal buffers as well as its queue.
      if ((frameIndex + 1) % STORY_VIDEO_FPS === 0 && frameIndex + 1 < FRAME_COUNT) {
        await waitForEncoder(encoder.flush());
      }
      onProgress((frameIndex + 1) / FRAME_COUNT * 0.98);
      if ((frameIndex + 1) % MAX_QUEUED_FRAMES === 0) {
        // Yield to input/painting, so progress and cancellation stay responsive.
        await Promise.race([new Promise((resolve) => setTimeout(resolve, 0)), interrupted]);
      }
    }

    await waitForEncoder(encoder.flush());
    if (encodedFrames !== FRAME_COUNT) {
      throw new Error('O navegador não codificou todos os quadros da arte. Tente exportar novamente.');
    }
    muxer.finalize();
    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    onProgress(1);
    checkState();
    return blob;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    closeEncoder();
    muxer = null;
    target.buffer = null;
  }
}
