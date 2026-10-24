import { getArtworkFormat } from '../stories/formats.js';
import { findConvertedBackground } from '../stories/format-conversion.js';

export async function resolveMagazineBackground(reference, formatName, backgrounds, requestJson) {
  if (!reference || !['stories', 'feed', 'encarte'].includes(reference.format)) return null;
  const sourceBackgrounds = reference.format === formatName ? backgrounds
    : (await requestJson(getArtworkFormat(reference.format).backgroundsUrl)).items || [];
  const source = sourceBackgrounds.find(item => item.arquivo === reference.arquivo);
  if (!source) return null;
  const background = reference.format === formatName ? source
    : findConvertedBackground(source, backgrounds) || source;
  return { ...background, url: background.preview_url || background.url };
}
