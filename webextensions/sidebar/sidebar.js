/*
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/
'use strict';

gLogContext = 'Sidebar-?';

var gTabBar;
var gAfterTabsForOverflowTabBar;
var gOutOfViewTabNotifier;
var gIndent = -1;
var gIndentProp = 'margin-left';
var gFaviconSize = 0;
var gFaviconizedTabSize = 0;
var gTabHeight = 0;
var gStyle;

window.addEventListener('DOMContentLoaded', earlyInit, { once: true });
window.addEventListener('load', init, { once: true });

blockUserOperations({ throbber: true });

var gSizeDefinition;
var gContextualIdentitiesStyle;
var gStyleLoader;
var gUserStyleRules;
var gAddonStyles = {};

async function earlyInit() {
  log('initialize sidebar on DOMContentLoaded');
  window.addEventListener('unload', destroy, { once: true });

  gTabBar = document.querySelector('#tabbar');
  gAfterTabsForOverflowTabBar = document.querySelector('#tabbar ~ .after-tabs');
  gOutOfViewTabNotifier = document.querySelector('#out-of-view-tab-notifier');
  gAllTabs = document.querySelector('#all-tabs');
  gSizeDefinition = document.querySelector('#size-definition');
  gStyleLoader = document.querySelector('#style-loader');
  gUserStyleRules = document.querySelector('#user-style-rules');
  gContextualIdentitiesStyle = document.querySelector('#contextual-identity-styling');
}

async function init() {
  log('initialize sidebar on load');
  window.addEventListener('resize', onResize);

  await configs.$loaded;
  await applyStyle();
  applyUserStyleRules();

  calculateDefaultSizes();

  await Promise.all([
    waitUntilBackgroundIsReady(),
    retrieveAllContextualIdentities()
  ]);
  document.documentElement.classList.remove('initializing');

  // workaround for https://bugzilla.mozilla.org/show_bug.cgi?id=1398272
  let response = await browser.runtime.sendMessage({
    type: kCOMMAND_PULL_TAB_ID_TABLES
  });
  gTabIdWrongToCorrect = response.wrongToCorrect;
  gTabIdCorrectToWrong = response.correctToWrong;

  await rebuildAll();

  updateContextualIdentitiesStyle();
  updateContextualIdentitiesSelector();
  startObserveContextualIdentities();

  browser.runtime.sendMessage({
    type:     kNOTIFY_SIDEBAR_OPENED,
    windowId: gTargetWindow
  });

  updateTabbarLayout({ justNow: true });

  await inheritTreeStructure();

  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  gTabBar.addEventListener('dblclick', onDblClick);
  gTabBar.addEventListener('transitionend', onTransisionEnd);
  startListenDragEvents(window);

  configs.$addObserver(onConfigChange);
  onConfigChange('debug');
  onConfigChange('sidebarPosition');
  onConfigChange('animation');

  browser.runtime.onMessage.addListener(onMessage);
  browser.runtime.onMessageExternal.addListener(onMessageExternal);

  var addons = await browser.runtime.sendMessage({
    type: kCOMMAND_REQUEST_REGISTERED_ADDONS
  });
  for (let id of Object.keys(addons)) {
    let addon = addons[id];
    if (addon.style)
      installStyleForAddon(id, addon.style);
  }

  tabContextMenu.init();

  unblockUserOperations({ throbber: true });
}

function destroy() {
  browser.runtime.sendMessage({
    type:     kNOTIFY_SIDEBAR_CLOSED,
    windowId: gTargetWindow
  });

  configs.$removeObserver(onConfigChange);
  browser.runtime.onMessage.removeListener(onMessage);
  browser.runtime.onMessageExternal.removeListener(onMessageExternal);
  endListenDragEvents(gTabBar);
  endObserveApiTabs();
  endObserveContextualIdentities();
  window.removeEventListener('resize', onResize);

  document.removeEventListener('mousedown', onMouseDown);
  document.removeEventListener('mouseup', onMouseUp);
  document.removeEventListener('click', onClick);
  document.removeEventListener('change', onChange);
  gTabBar.removeEventListener('dblclick', onDblClick);
  gTabBar.removeEventListener('transitionend', onTransisionEnd);

  gAllTabs = gTabBar = gAfterTabsForOverflowTabBar = undefined;
}

function getChosenStyle() {
  var style = configs.style;
  if (!style && navigator.platform.indexOf('Linux') == 0)
    style = configs.defaultStyleLinux;
  if (!style && navigator.platform.indexOf('Darwin') == 0)
    style = configs.defaultStyleDarwin;
  if (!style)
    style = configs.defaultStyle;
  if (!configs.style)
    configs.style = style; // cache auto-detected default
  return style;
}

function applyStyle() {
  gStyle = getChosenStyle();
  switch (gStyle) {
    case 'metal':
      gStyleLoader.setAttribute('href', 'styles/metal/metal.css');
      break;
    case 'sidebar':
      gStyleLoader.setAttribute('href', 'styles/sidebar/sidebar.css');
      break;
    case 'mixed':
      gStyleLoader.setAttribute('href', 'styles/square/mixed.css');
      break;
    case 'flat':
      gStyleLoader.setAttribute('href', 'styles/square/flat.css');
      break;
    case 'vertigo':
      gStyleLoader.setAttribute('href', 'styles/square/vertigo.css');
      break;
    case 'plain-dark':
      gStyleLoader.setAttribute('href', 'styles/square/plain-dark.css');
      break;
    default:
      gStyleLoader.setAttribute('href', 'styles/square/plain.css');
      break;
  }
  return new Promise((aResolve, aReject) => {
    gStyleLoader.addEventListener('load', () => {
      nextFrame().then(aResolve);
    }, { once: true });
  });
}

function applyUserStyleRules() {
  gUserStyleRules.textContent = configs.userStyleRules || '';
}

function calculateDefaultSizes() {
  // first, calculate actual favicon size.
  gFaviconSize = document.querySelector('#dummy-favicon-size-box').getBoundingClientRect().height;
  var scale = Math.max(configs.faviconizedTabScale, 1);
  gFaviconizedTabSize = parseInt(gFaviconSize * scale);
  log('gFaviconSize / gFaviconizedTabSize ', gFaviconSize, gFaviconizedTabSize);
  gSizeDefinition.textContent = `:root {
    --favicon-size: ${gFaviconSize}px;
    --faviconized-tab-size: ${gFaviconizedTabSize}px;
  }`;
  var dummyTab = document.querySelector('#dummy-tab');
  gTabHeight = dummyTab.getBoundingClientRect().height;
  log('gTabHeight ', gTabHeight);
  gSizeDefinition.textContent += `:root {
    --tab-height: ${gTabHeight}px;

    --indent-duration: ${configs.indentDuration}ms;
    --collapse-duration: ${configs.collapseDuration}ms;
    --out-of-view-tab-notify-duration: ${configs.outOfViewTabNotifyDuration}ms;
  }`;
}

function updateContextualIdentitiesStyle() {
  var definitions = [];
  for (let id of Object.keys(gContextualIdentities)) {
    let identity = gContextualIdentities[id];
    if (!identity.colorCode)
      continue;
    definitions.push(`
      .tab.contextual-identity-${id} .contextual-identity-marker {
        background-color: ${identity.colorCode};
      }
    `);
  }
  gContextualIdentitiesStyle.textContent = definitions.join('\n');
}

function updateContextualIdentitiesSelector() {
  var selectors = Array.slice(document.querySelectorAll(`.${kCONTEXTUAL_IDENTITY_SELECTOR}`));
  var identityIds = Object.keys(gContextualIdentities);
  var range = document.createRange();
  for (let selector of selectors) {
    range.selectNodeContents(selector);
    range.deleteContents();
    if (identityIds.length == 0) {
      selector.setAttribute('disabled', true);
      continue;
    }
    selector.removeAttribute('disabled');
    let fragment = document.createDocumentFragment();
    let defaultItem = document.createElement('option');
    defaultItem.setAttribute('value', '');
    fragment.appendChild(defaultItem);
    for (let id of identityIds) {
      let identity = gContextualIdentities[id];
      let item = document.createElement('option');
      item.setAttribute('value', id);
      if (identity.colorCode) {
        item.style.color = getReadableForegroundColorFromBGColor(identity.colorCode);
        item.style.backgroundColor = identity.colorCode;
      }
      item.textContent = identity.name;
      fragment.appendChild(item);
    }
    range.insertNode(fragment);
  }
  range.detach();
}

function getReadableForegroundColorFromBGColor(aCode) { // expected input: 'RRGGBB' or 'RGB'
  var parts = aCode.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/) ||
              aCode.match(/^#?([0-9a-f])([0-9a-f])([0-9a-f])/);
  if (!parts)
    return '-moz-fieldtext';
  var red   = parseInt(parts[1], 16);
  var green = parseInt(parts[2], 16);
  var blue  = parseInt(parts[3], 16);
  var brightness = (red * 0.299 + green * 0.587 + blue * 0.114) / 255;
  return brightness < 0.5 ? 'white' : 'black';
}

function installStyleForAddon(aId, aStyle) {
  if (!gAddonStyles[aId]) {
    gAddonStyles[aId] = document.createElement('style');
    gAddonStyles[aId].setAttribute('type', 'text/css');
    document.head.insertBefore(gAddonStyles[aId], gUserStyleRules);
  }
  gAddonStyles[aId].textContent = aStyle;
}

function uninstallStyleForAddon(aId) {
  if (!gAddonStyles[aId])
    return;
  document.head.removeChild(gAddonStyles[aId]);
  delete gAddonStyles[aId];
}

async function rebuildAll() {
  var apiTabs = await browser.tabs.query({ currentWindow: true });
  gTargetWindow = apiTabs[0].windowId;
  gLogContext = `Sidebar-${gTargetWindow}`;
  clearAllTabsContainers();
  var container = buildTabsContainerFor(gTargetWindow);
  for (let apiTab of apiTabs) {
    // workaround for https://bugzilla.mozilla.org/show_bug.cgi?id=1398272
    if (apiTab.id in gTabIdWrongToCorrect)
      apiTab.id = gTabIdWrongToCorrect[apiTab.id];
    let newTab = buildTab(apiTab, { existing: true, inRemote: true });
    container.appendChild(newTab);
    updateTab(newTab, apiTab, { forceApply: true });
  }
  gAllTabs.appendChild(container);
  startObserveApiTabs();
}

async function inheritTreeStructure() {
  var response = await browser.runtime.sendMessage({
    type:     kCOMMAND_PULL_TREE_STRUCTURE,
    windowId: gTargetWindow
  });
  if (response.structure)
    await applyTreeStructureToTabs(getAllTabs(gTargetWindow), response.structure);
}

async function waitUntilBackgroundIsReady() {
  try {
    let response = await browser.runtime.sendMessage({
      type: kCOMMAND_PING_TO_BACKGROUND
    });
    if (response)
      return;
  }
  catch(e) {
  }
  return new Promise((aResolve, aReject) => {
    let onBackgroundIsReady = (aMessage, aSender, aRespond) => {
      if (!aMessage ||
          !aMessage.type ||
          aMessage.type != kCOMMAND_PING_TO_SIDEBAR)
        return;
      browser.runtime.onMessage.removeListener(onBackgroundIsReady);
      aResolve();
    };
    browser.runtime.onMessage.addListener(onBackgroundIsReady);
  });
}


function getTabTwisty(aTab) {
  return aTab.querySelector(`.${kTWISTY}`);
}
function getTabFavicon(aTab) {
  return aTab.querySelector(`.${kFAVICON}`);
}
function getTabThrobber(aTab) {
  return aTab.querySelector(`.${kTHROBBER}`);
}
function getTabSoundButton(aTab) {
  return aTab.querySelector(`.${kSOUND_BUTTON}`);
}
function getTabCounter(aTab) {
  return aTab.querySelector(`.${kCOUNTER}`);
}
function getTabClosebox(aTab) {
  return aTab.querySelector(`.${kCLOSEBOX}`);
}


function updateTabTwisty(aTab) {
  var tooltip;
  if (isSubtreeCollapsed(aTab))
    tooltip = browser.i18n.getMessage('tab.twisty.collapsed.tooltip');
  else
    tooltip = browser.i18n.getMessage('tab.twisty.expanded.tooltip');
  getTabTwisty(aTab).setAttribute('title', tooltip);
}

function updateTabClosebox(aTab) {
  var tooltip;
  if (hasChildTabs(aTab) && isSubtreeCollapsed(aTab))
    tooltip = browser.i18n.getMessage('tab.closebox.tree.tooltip');
  else
    tooltip = browser.i18n.getMessage('tab.closebox.tab.tooltip');
  getTabClosebox(aTab).setAttribute('title', tooltip);
}

function updateTabsCount(aTab) {
  var counter = getTabCounter(aTab);
  if (!counter)
    return;
  var descendants = getDescendantTabs(aTab);
  var count = descendants.length;
  if (configs.counterRole == kCOUNTER_ROLE_ALL_TABS)
    count += 1;
  counter.textContent = count;
}

function collapseExpandAllSubtree(aParams = {}) {
  var container = getTabsContainer(gTargetWindow);
  var subtreeCondition = aParams.collapsed ?
        `:not(.${kTAB_STATE_SUBTREE_COLLAPSED})` :
        `.${kTAB_STATE_SUBTREE_COLLAPSED}`
  var tabs = container.querySelectorAll(`.tab:not([${kCHILDREN}="|"])${subtreeCondition}`);
  for (let tab of tabs) {
    collapseExpandSubtree(tab, aParams);
  }
}


function reserveToUpdateIndent() {
  //log('reserveToUpdateIndent');
  if (reserveToUpdateIndent.waiting)
    clearTimeout(reserveToUpdateIndent.waiting);
  reserveToUpdateIndent.waiting = setTimeout(() => {
    delete reserveToUpdateIndent.waiting;
    updateIndent();
  }, 100);
}

var gIndentDefinition;
var gLastMaxLevel;

function updateIndent(aOptions = {}) {
  var maxLevel = getMaxTreeLevel(gTargetWindow, {
                   onlyVisible: configs.indentAutoShrinkOnlyForVisible
                 });
  if (isNaN(maxLevel))
    maxLevel = 0;
  if (configs.maxTreeLevel > -1)
    maxLevel = Math.min(maxLevel, configs.maxTreeLevel);

  //log('maxLevel ', maxLevel);

  var oldIndent = gIndent;
  var indent    = (oldIndent < 0 ? configs.baseIndent : oldIndent ) * maxLevel;
  var maxIndent = gTabBar.getBoundingClientRect().width * (0.33);
  var minIndent= Math.max(kDEFAULT_MIN_INDENT, configs.minIndent);
  var indentUnit = Math.min(configs.baseIndent, Math.max(Math.floor(maxIndent / maxLevel), minIndent));
  //log('calculated result: ', { oldIndent, indent, maxIndent, minIndent, indentUnit });
  if (indent > maxIndent) {
    gIndent = indentUnit;
  }
  else {
    gIndent = -1;
    if ((configs.baseIndent * maxLevel) > maxIndent)
      gIndent = indentUnit;
  }

  if (!aOptions.force &&
      oldIndent == gIndent &&
      gIndentDefinition &&
      maxLevel == gLastMaxLevel)
    return;

  gLastMaxLevel = maxLevel;

  if (!gIndentDefinition) {
    gIndentDefinition = document.createElement('style');
    gIndentDefinition.setAttribute('type', 'text/css');
    document.head.appendChild(gIndentDefinition);
  }

  // prepare definitions for all tabs including collapsed.
  // otherwise, we'll see odd animation for expanded tabs
  // from indent=0 to indent=expected.
  var definitionsMaxLevel = getMaxTreeLevel(gTargetWindow);
  var definitions = [];
  // default indent for unhandled (deep) level tabs
  definitions.push(`.tab[${kPARENT}]:not([${kLEVEL}="0"]) { ${gIndentProp}: ${definitionsMaxLevel + 1 * indentUnit}px; }`);
  for (let level = 1; level <= definitionsMaxLevel; level++) {
    definitions.push(`.tab[${kPARENT}][${kLEVEL}="${level}"] { ${gIndentProp}: ${level * indentUnit}px; }`);
  }
  gIndentDefinition.textContent = definitions.join('\n');
  //log('updated indent definition: ', gIndentDefinition.textContent);
}


function reserveToUpdateTabbarLayout(aTimeout) {
  //log('reserveToUpdateTabbarLayout');
  if (reserveToUpdateTabbarLayout.waiting)
    clearTimeout(reserveToUpdateTabbarLayout.waiting);
  reserveToUpdateTabbarLayout.waiting = setTimeout(() => {
    delete reserveToUpdateTabbarLayout.waiting;
    updateTabbarLayout();
  }, aTimeout || 10);
}

function updateTabbarLayout(aParams = {}) {
  //log('updateTabbarLayout');
  var range = document.createRange();
  range.selectNodeContents(gTabBar);
  var containerHeight = gTabBar.getBoundingClientRect().height;
  var contentHeight = range.getBoundingClientRect().height;
  //log('height: ', { container: containerHeight, content: contentHeight });
  var overflow = containerHeight < contentHeight;
  if (overflow && !gTabBar.classList.contains(kTABBAR_STATE_OVERFLOW)) {
    //log('overflow');
    gTabBar.classList.add(kTABBAR_STATE_OVERFLOW);
    let range = document.createRange();
    range.selectNodeContents(gAfterTabsForOverflowTabBar);
    range.setStartAfter(gOutOfViewTabNotifier);
    let offset = range.getBoundingClientRect().height;
    range.detach();
    gTabBar.style.bottom = `${offset}px`;
  }
  else if (!overflow && gTabBar.classList.contains(kTABBAR_STATE_OVERFLOW)) {
    //log('underflow');
    gTabBar.classList.remove(kTABBAR_STATE_OVERFLOW);
    gTabBar.style.bottom = '';
  }

  reserveToPositionPinnedTabs(aParams);
}


async function notifyOutOfViewTab(aTab) {
  await nextFrame();
  cancelNotifyOutOfViewTab();
  if (aTab && isTabInViewport(aTab))
    return;
  gOutOfViewTabNotifier.classList.add('notifying');
  await wait(configs.outOfViewTabNotifyDuration);
  cancelNotifyOutOfViewTab();
}

function cancelNotifyOutOfViewTab() {
  gOutOfViewTabNotifier.classList.remove('notifying');
}

