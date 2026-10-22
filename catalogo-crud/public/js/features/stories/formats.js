import {
  STORY_WIDTH, STORY_HEIGHT, STORY_SAFE_TOP, STORY_SAFE_BOTTOM,
  DEFAULT_PRODUCT_AREA, DEFAULT_TWO_PRODUCT_AREAS, DEFAULT_DETAILS_WIDTH,
} from './constants.js';

// Stories keeps its original geometry. Both pages use the same editor and exports.
const formats = {
  stories: {
    width: STORY_WIDTH,
    height: STORY_HEIGHT,
    safeTop: STORY_SAFE_TOP,
    safeBottom: STORY_SAFE_BOTTOM,
    productArea: DEFAULT_PRODUCT_AREA,
    twoProductAreas: DEFAULT_TWO_PRODUCT_AREAS,
    detailsWidth: DEFAULT_DETAILS_WIDTH,
    detailsTop: 1120,
    backgroundsUrl: '/api/story-backgrounds',
    downloadPrefix: 'story',
  },
  feed: {
    width: 1080,
    height: 1350,
    safeTop: Math.round(1350 * 0.2),
    safeBottom: 0,
    productArea: { x: 124, y: 430, width: 832, height: 430 },
    twoProductAreas: {
      product: { x: 82, y: 430, width: 430, height: 430 },
      'product-secondary': { x: 568, y: 430, width: 430, height: 430 },
    },
    detailsWidth: 740,
    detailsTop: 930,
    backgroundsUrl: '/api/feed-backgrounds',
    downloadPrefix: 'feed',
  },
};

export function getArtworkFormat(name = 'stories') {
  return formats[name] || formats.stories;
}
