import { initStoriesEditor } from './js/features/stories/editor.js';

const initialLoad = initStoriesEditor();
globalThis.appLoading?.track(initialLoad);
