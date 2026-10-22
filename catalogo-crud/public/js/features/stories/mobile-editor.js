const PANELS = Object.freeze({
  background: 'Escolha o fundo', products: 'Composição e produtos',
  offer: 'Preço e texto da oferta', export: 'Salve sua arte',
});

function isTextEntry(element) {
  if (!element || element.disabled || element.readOnly) return false;
  if (element.isContentEditable || element.tagName === 'TEXTAREA') return true;
  return element.tagName === 'INPUT'
    && !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(element.type);
}

/** Reuses desktop controls in a dismissible mobile dialog; the canvas stays expanded. */
export function initStoriesMobileEditor({ root = document, getProgress = () => ({}), onStepChange = () => {} } = {}) {
  const doc = root.ownerDocument || root;
  const view = doc.defaultView;
  const body = doc.body;
  const find = (selector) => root.querySelector(selector);
  const dialog = find('#story-mobile-dialog');
  if (!view?.matchMedia || !body || !dialog?.showModal) {
    return { sync() {}, showStep() {}, selectionComplete() {}, close() {}, destroy() {} };
  }
  const media = view.matchMedia('(max-width: 900px)');
  const panels = new Map(Object.keys(PANELS).map((id) => [id, find(`#story-mobile-panel-${id}`)]));
  const launchers = [...root.querySelectorAll('[data-mobile-panel]')];
  const title = find('#story-mobile-dialog-title');
  const closeButton = find('#story-mobile-close');
  const confirm = find('#story-mobile-confirm');
  const footer = find('#story-mobile-dialog-footer');
  const scrollport = find('.story-mobile-panels');
  const status = find('#story-mobile-status');
  const canvasStatus = find('#story-mobile-canvas-status');
  const sourceStatus = find('#story-status');
  const autoLayout = find('#story-mobile-auto-layout');
  const anchor = find('#story-mobile-anchor');
  const originalAutoLayout = find('#story-auto-layout-button');
  const originalAnchor = find('#story-elements-anchor');
  const anchorSection = find('#story-anchor-section');
  const originalLocations = new Map();
  const cleanup = [];
  let current = null;
  let opener = null;
  let mobile = false;
  let destroyed = false;
  let frame = null;
  let baselineHeight = 0;
  let baselineWidth = 0;
  let backdropPress = false;

  function listen(target, type, listener, options) {
    target?.addEventListener(type, listener, options);
    cleanup.push(() => target?.removeEventListener(type, listener, options));
  }

  function updateViewport() {
    frame = null;
    if (!mobile || destroyed) return;
    const viewport = view.visualViewport;
    const layoutHeight = Math.max(view.innerHeight || 0, doc.documentElement?.clientHeight || 0);
    const layoutWidth = view.innerWidth || doc.documentElement?.clientWidth || 0;
    const visibleHeight = viewport?.height || layoutHeight;
    const editing = isTextEntry(doc.activeElement);
    if (Math.abs(layoutWidth - baselineWidth) > 80) baselineHeight = layoutHeight;
    baselineWidth = layoutWidth;
    if (!editing || !baselineHeight) baselineHeight = Math.max(layoutHeight, visibleHeight);
    body.style.setProperty('--story-viewport-height', `${Math.round(visibleHeight)}px`);
    body.style.setProperty('--story-viewport-top', `${Math.max(0, Math.round(viewport?.offsetTop || 0))}px`);
    body.classList.toggle('story-mobile-keyboard-open', editing
      && (!viewport || Math.abs((viewport.scale || 1) - 1) < 0.05)
      && baselineHeight - visibleHeight > Math.max(120, baselineHeight * 0.18));
  }

  function scheduleViewport() {
    if (frame === null && mobile && !destroyed) frame = view.requestAnimationFrame(updateViewport);
  }

  function sync() {
    if (destroyed) return;
    const progress = getProgress() || {};
    for (const [id, panel] of panels) if (panel) panel.hidden = !mobile || current !== id;
    for (const launcher of launchers) {
      launcher.setAttribute('aria-expanded', String(mobile && current === launcher.dataset.mobilePanel));
      launcher.classList.toggle('is-ready', Boolean(progress[launcher.dataset.mobilePanel]));
    }
    if (title && current) title.textContent = PANELS[current];
    if (footer) footer.hidden = current !== 'offer';
    if (status && sourceStatus && status.textContent !== sourceStatus.textContent) status.textContent = sourceStatus.textContent;
    status?.classList.toggle('is-error', Boolean(sourceStatus?.classList.contains('is-error')));
    const canvasError = mobile && Boolean(sourceStatus?.classList.contains('is-error'));
    body.classList.toggle('story-mobile-has-error', canvasError);
    if (canvasStatus) {
      const message = canvasError ? sourceStatus.textContent : '';
      if (canvasStatus.textContent !== message) canvasStatus.textContent = message;
      canvasStatus.hidden = !canvasError;
    }
    if (autoLayout) autoLayout.disabled = !originalAutoLayout || originalAutoLayout.disabled;
    if (anchor) {
      anchor.disabled = !originalAnchor || Boolean(anchorSection?.hidden);
      anchor.setAttribute('aria-pressed', String(Boolean(originalAnchor?.checked)));
    }
    dialog.setAttribute('aria-busy', String(Boolean(progress.exporting)));
  }

  function finishClose({ restoreFocus = true } = {}) {
    if (!current) return;
    if (isTextEntry(doc.activeElement) && dialog.contains(doc.activeElement)) doc.activeElement.blur();
    current = null;
    body.classList.remove('story-mobile-modal-open');
    delete body.dataset.mobilePanel;
    const returnFocus = opener;
    opener = null;
    sync();
    onStepChange('canvas');
    if (restoreFocus && mobile && returnFocus && !returnFocus.disabled) returnFocus.focus({ preventScroll: true });
    scheduleViewport();
  }

  function close(options) {
    const returnFocus = opener;
    finishClose({ restoreFocus: false });
    if (dialog.open) dialog.close();
    if (options?.restoreFocus !== false && mobile && returnFocus && !returnFocus.disabled) returnFocus.focus({ preventScroll: true });
  }

  function showStep(id, { focus = true, trigger = null } = {}) {
    if (destroyed || !mobile || !panels.has(id)) return false;
    if (!dialog.open) opener = trigger || launchers.find((button) => button.dataset.mobilePanel === id) || doc.activeElement;
    if (current !== id && dialog.contains(doc.activeElement) && isTextEntry(doc.activeElement)) doc.activeElement.blur();
    current = id;
    body.dataset.mobilePanel = id;
    body.classList.add('story-mobile-modal-open');
    sync();
    for (const toggle of panels.get(id)?.querySelectorAll('.story-section-collapse-toggle[aria-expanded="false"]') || []) toggle.click();
    if (scrollport) scrollport.scrollTop = 0;
    onStepChange(id);
    if (!dialog.open) dialog.showModal();
    if (focus) {
      const priceInput = id === 'offer' ? find('#story-price') : null;
      // Keep focus in the tap handler so mobile Safari can open the numeric keyboard.
      const focusTarget = isTextEntry(priceInput) ? priceInput : closeButton;
      focusTarget?.focus({ preventScroll: true });
    }
    scheduleViewport();
    return true;
  }

  function moveControls() {
    for (const control of root.querySelectorAll('[data-mobile-group]')) {
      const panel = panels.get(control.dataset.mobileGroup);
      if (!panel || originalLocations.has(control)) continue;
      const placeholder = doc.createComment(`story-mobile:${control.dataset.mobileGroup}`);
      control.parentNode.insertBefore(placeholder, control);
      originalLocations.set(control, placeholder);
      panel.append(control);
    }
  }

  function restoreControls() {
    for (const [control, placeholder] of originalLocations) {
      if (placeholder.parentNode) placeholder.parentNode.replaceChild(control, placeholder);
    }
    originalLocations.clear();
  }

  function setMobile(value) {
    if (destroyed || mobile === value) return;
    const focused = doc.activeElement;
    const focusedControl = [...originalLocations.keys()].some((control) => control.contains(focused));
    const focusedMobile = dialog.contains(focused) || focused?.closest?.('.story-mobile-only');
    mobile = value;
    body.classList.toggle('is-mobile-editor', mobile);
    if (mobile) {
      baselineHeight = Math.max(view.innerHeight || 0, doc.documentElement?.clientHeight || 0);
      baselineWidth = view.innerWidth || 0;
      const focusedGroup = focused?.closest?.('[data-mobile-group]')?.dataset.mobileGroup;
      moveControls();
      updateViewport();
      sync();
      onStepChange('canvas');
      if (panels.has(focusedGroup)) {
        showStep(focusedGroup, { focus: false });
        focused.focus({ preventScroll: true });
      }
    } else {
      close({ restoreFocus: false });
      restoreControls();
      body.classList.remove('story-mobile-keyboard-open');
      body.style.removeProperty('--story-viewport-height');
      body.style.removeProperty('--story-viewport-top');
      sync();
      onStepChange('canvas');
      if (focusedControl) focused.focus({ preventScroll: true });
      else if (focusedMobile) find('.stories-back-link')?.focus({ preventScroll: true });
    }
  }

  for (const launcher of launchers) listen(launcher, 'click', () => showStep(launcher.dataset.mobilePanel, { trigger: launcher }));
  listen(closeButton, 'click', () => close());
  listen(confirm, 'click', () => close());
  listen(dialog, 'cancel', (event) => { event.preventDefault(); close(); });
  listen(dialog, 'close', () => { if (!dialog.open) finishClose(); });
  listen(dialog, 'pointerdown', (event) => { backdropPress = event.target === dialog; });
  listen(dialog, 'click', (event) => { if (backdropPress && event.target === dialog) close(); backdropPress = false; });
  listen(autoLayout, 'click', () => { originalAutoLayout?.click(); sync(); });
  listen(anchor, 'click', () => {
    if (!originalAnchor || anchor.disabled) return;
    originalAnchor.checked = !originalAnchor.checked;
    originalAnchor.dispatchEvent(new view.Event('change', { bubbles: true }));
    sync();
  });
  // The mobile tour highlights floating controls instead of opening another dialog.
  listen(doc, 'story:reveal-target', () => { if (mobile && dialog.open) close({ restoreFocus: false }); });
  listen(doc, 'focusin', scheduleViewport);
  listen(doc, 'focusout', scheduleViewport);
  listen(view, 'resize', scheduleViewport, { passive: true });
  listen(view, 'orientationchange', scheduleViewport, { passive: true });
  listen(view.visualViewport, 'resize', scheduleViewport, { passive: true });
  listen(view.visualViewport, 'scroll', scheduleViewport, { passive: true });
  const changeMedia = () => setMobile(media.matches);
  if (media.addEventListener) listen(media, 'change', changeMedia);
  else { media.addListener(changeMedia); cleanup.push(() => media.removeListener(changeMedia)); }
  sync();
  setMobile(media.matches);
  return {
    sync, showStep, close,
    selectionComplete(id, complete = true) {
      if (complete && current === id && ['background', 'products'].includes(id)) close();
    },
    destroy() {
      if (destroyed) return;
      setMobile(false);
      destroyed = true;
      if (frame !== null) view.cancelAnimationFrame(frame);
      cleanup.forEach((remove) => remove());
    },
  };
}
