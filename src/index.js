import { join, dirname, delimiter, sep, isAbsolute } from 'path';
import { access, readdir } from 'fs/promises';
import { log } from './lib/logger.js';

import Chromium from './browser/chromium.js';
import Firefox from './browser/firefox.js';

import * as ExtensionsAPI from './extensions.js';
import LocalHTTP from './lib/local/http.js';
import { getBrowserPaths } from './browserPaths.js'

process.versions.gluon = '0.13.0-alpha.2';

const browserPaths = getBrowserPaths()

let _binariesInPath; // cache as to avoid excessive reads
const getBinariesInPath = async () => {
  if (_binariesInPath) return _binariesInPath;

  return _binariesInPath = (await Promise.all(process.env.PATH
    .replaceAll('"', '')
    .split(delimiter)
    .filter(Boolean)
    .map(x => readdir(x.replace(/"+/g, '')).catch(() => [])))).flat();
};

const exists = async path => {
  if (path.includes(sep)) return await access(path).then(() => true).catch(() => false);

  // just binary name, so check path
  return (await getBinariesInPath()).includes(path);
};

const getBrowserPath = async browser => {
  for (const path of Array.isArray(browserPaths[browser]) ? browserPaths[browser] : [ browserPaths[browser] ]) {
    // log('checking if ' + browser + ' exists:', path, await exists(path));

    if (await exists(path)) return path;
  }

  return null;
};

const findBrowserPath = async (forceBrowser, forceEngine) => {
  if (forceBrowser) return [ await getBrowserPath(forceBrowser), forceBrowser ];

  for (const x in browserPaths) {
    if (process.argv.includes('--' + x) || process.argv.includes('--' + x.split('_')[0])) return [ await getBrowserPath(x), x ];
  }

  if (process.argv.some(x => x.startsWith('--browser='))) {
    const given = process.argv.find(x => x.startsWith('--browser='));
    const split = given.slice(given.indexOf('=') + 1).split(',');
    const name = split[0];
    const path = split.slice(1).join(',');

    return [ path || await getBrowserPath(name), name ];
  }

  for (const name in browserPaths) {
    const path = await getBrowserPath(name);

    if (path) {
      if (forceEngine && getBrowserType(name) !== forceEngine) continue; // if forceEngine is set, ignore path if it isn't

      return [ path, name ];
    }
  }

  return null;
};

const getFriendlyName = whichBrowser => whichBrowser[0].toUpperCase() + whichBrowser.slice(1).replace(/[a-z]_[a-z]/g, _ => _[0] + ' ' + _[2].toUpperCase());

const ranJsDir = !process.argv[1] ? __dirname : (process.argv[1].endsWith('.js') ? dirname(process.argv[1]) : process.argv[1]);
const getDataPath = browser => join(ranJsDir, 'gluon_data', browser);

const getBrowserType = name => { // todo: not need this
  if (name.startsWith('firefox') ||
    [ 'librewolf', 'waterfox' ].includes(name)) return 'firefox';

  return 'chromium';
};

const portRange = [ 10000, 60000 ];
const generatePort = () => (Math.floor(Math.random() * (portRange[1] - portRange[0] + 1)) + portRange[0]);

const startBrowser = async (url, { allowHTTP = false, allowRedirects = 'same-origin', windowSize, forceBrowser, forceEngine }) => {
  const [ browserPath, browserName ] = await findBrowserPath(forceBrowser, forceEngine);
  const browserFriendlyName = getFriendlyName(browserName);

  if (!browserPath) return log('failed to find a good browser install');

  const dataPath = getDataPath(browserName);
  const browserType = getBrowserType(browserName);

  log('found browser', browserName, `(${browserType} based)`, 'at path:', browserPath);
  log('data path:', dataPath);

  const openingLocal = !url.includes('://');
  const localUrl = browserType === 'firefox' ? `http://localhost:${generatePort()}` : 'https://gluon.local';
  const basePath = isAbsolute(url) ? url : join(ranJsDir, url);

  const closeHandlers = [];
  if (openingLocal && browserType === 'firefox') closeHandlers.push(await LocalHTTP({ localUrl, url: basePath }));

  const Window = await (browserType === 'firefox' ? Firefox : Chromium)({
    dataPath,
    browserPath
  }, {
    url: openingLocal ? localUrl : url,
    windowSize,
    allowHTTP,
    extensions: ExtensionsAPI._extensions[browserType]
  }, {
    browserName: browserFriendlyName,
    url: openingLocal ? basePath : url,
    localUrl,
    openingLocal,
    closeHandlers,
    browserType,
    dataPath,
    allowRedirects
  });

  return Window;
};

export const open = async (url, opts = {}) => {
  const { onLoad, allowHTTP = false } = opts;

  if (allowHTTP !== true && url.startsWith('http://')) throw new Error(`HTTP URLs are blocked by default. Please use HTTPS, or if not possible, enable the 'allowHTTP' option.`);

  log('starting browser...');

  const Browser = await startBrowser(url, opts);

  if (onLoad) {
    const toRun = `(() => {
      if (window.self !== window.top) return; // inside frame

      (${onLoad.toString()})();
    })();`;

    Browser.page.eval(toRun);

    await Browser.cdp.send(`Page.addScriptToEvaluateOnNewDocument`, {
      source: toRun
    });
  }

  return Browser;
};

export const extensions = {
  add: ExtensionsAPI.add,
  remove: ExtensionsAPI.remove
};