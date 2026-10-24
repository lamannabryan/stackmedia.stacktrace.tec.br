import {
  STORY_WIDTH, STORY_HEIGHT, STORY_SAFE_TOP, STORY_SAFE_BOTTOM,
  DEFAULT_PRODUCT_AREA, DEFAULT_TWO_PRODUCT_AREAS, DEFAULT_DETAILS_WIDTH,
} from './constants.js';

// All formats share the editor and exports, with their own geometry and backgrounds.
const formats = {
  encarte: {
    width: 1080,
    height: 1440,
    safeTop: 302,
    safeBottom: 0,
    footerRatio: 0.16,
    maxProducts: 5,
    productArea: { x: 124, y: 200, width: 832, height: 580 },
    twoProductAreas: {
      product: { x: 82, y: 200, width: 430, height: 580 },
      'product-secondary': { x: 568, y: 200, width: 430, height: 580 },
    },
    detailsWidth: 740,
    detailsTop: 840,
    backgroundsUrl: '/api/encarte-backgrounds',
    downloadPrefix: 'encarte',
  },
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
