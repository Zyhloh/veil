#!/usr/bin/env node
//
// Veil Steam manifest dumper sidecar.
//
// Communicates with the Rust host via line-delimited JSON over stdin/stdout.
//
// Request shape:   { "id": <int>, "cmd": "<name>", ...args }
// Response shape:  { "id": <int>, "ok": <bool>, "data": <any>, "error": <string?> }
// Event shape:     { "event": "<name>", ...payload }   (no id; unsolicited)
//

const readline = require('readline');
const fs = require('fs');
const path = require('path');

const SteamUser = require('steam-user');
const {
  LoginSession,
  EAuthTokenPlatformType,
  EAuthSessionGuardType,
} = require('steam-session');

let loginSession = null;
let steamClient = null;
let pendingLoginRequestId = null; // id of the original login request awaiting Steam Guard

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function sendEvent(event, payload = {}) {
  send({ event, ...payload });
}

function reply(id, ok, payload) {
  if (ok) {
    send({ id, ok: true, data: payload || {} });
  } else {
    const error = payload && payload.message ? payload.message : String(payload || 'unknown error');
    send({ id, ok: false, error });
  }
}

function mapLoginError(err) {
  // Surface stack on weird runtime errors so we can see what's blowing up.
  if (err && err.stack && process.env.VEIL_DUMPER_DEBUG) {
    sendEvent('debug', { stack: err.stack });
  }
  let msg = (err && err.message) || String(err);
  if (err && err.stack && /is not a function/.test(msg)) {
    msg = msg + ' — ' + err.stack.split('\n').slice(0, 3).join(' | ');
  }
  const eresult = err && err.eresult;
  if (eresult === 84 || msg.includes('RateLimitExceeded')) {
    return 'Too many login attempts. Wait a few minutes and try again.';
  }
  if (eresult === 87 || msg.includes('AccountLoginDeniedThrottle')) {
    return 'Login temporarily blocked. Wait 15-30 minutes and try again.';
  }
  if (eresult === 5 || msg.includes('InvalidPassword')) {
    return 'Invalid username or password.';
  }
  if (eresult === 18 || msg.includes('AccountNotFound')) {
    return 'Account not found. Check your username.';
  }
  return msg;
}

function makeSteamUser() {
  return new SteamUser({
    enablePicsCache: true,
    promptSteamGuardCode: false,
  });
}

function logOnWithToken(refreshToken) {
  return new Promise((resolve, reject) => {
    const user = makeSteamUser();
    const cleanup = () => {
      user.removeListener('loggedOn', onLogged);
      user.removeListener('error', onError);
    };
    const onLogged = () => { cleanup(); resolve(user); };
    const onError = (err) => { cleanup(); reject(err); };
    user.once('loggedOn', onLogged);
    user.once('error', onError);
    user.logOn({ refreshToken });
  });
}

async function handleLogin(id, msg) {
  // Refresh-token path: silent re-auth, no Steam Guard.
  if (msg.refresh_token) {
    try {
      steamClient = await logOnWithToken(msg.refresh_token);
      reply(id, true, { via: 'refresh_token', refresh_token: msg.refresh_token });
    } catch (err) {
      reply(id, false, { message: 'Saved session expired, please login again.' });
    }
    return;
  }

  // Username/password path via steam-session.
  if (!msg.username || !msg.password) {
    reply(id, false, { message: 'Username and password required' });
    return;
  }

  try {
    loginSession = new LoginSession(EAuthTokenPlatformType.SteamClient);

    loginSession.on('authenticated', async () => {
      const token = loginSession.refreshToken;
      try {
        steamClient = await logOnWithToken(token);
        const targetId = pendingLoginRequestId || id;
        pendingLoginRequestId = null;
        reply(targetId, true, { via: 'credentials', refresh_token: token });
      } catch (err) {
        const targetId = pendingLoginRequestId || id;
        pendingLoginRequestId = null;
        reply(targetId, false, { message: 'Logged in but Steam client failed: ' + (err.message || err) });
      }
    });

    loginSession.on('timeout', () => {
      const targetId = pendingLoginRequestId || id;
      pendingLoginRequestId = null;
      reply(targetId, false, { message: 'Login timed out' });
    });

    loginSession.on('error', (err) => {
      const targetId = pendingLoginRequestId || id;
      pendingLoginRequestId = null;
      reply(targetId, false, { message: mapLoginError(err) });
    });

    const startResult = await loginSession.startWithCredentials({
      accountName: msg.username,
      password: msg.password,
    });

    if (startResult.actionRequired) {
      const validActions = startResult.validActions || [];
      const deviceConfirm = validActions.find(a => a.type === EAuthSessionGuardType.DeviceConfirmation);
      const codeAction = validActions.find(a =>
        a.type === EAuthSessionGuardType.DeviceCode ||
        a.type === EAuthSessionGuardType.EmailCode
      );

      if (deviceConfirm) {
        // Phone confirmation: keep the request open, the 'authenticated' handler
        // will reply once the user approves. steam-session polls automatically.
        pendingLoginRequestId = id;
        sendEvent('needs_device_confirmation');
        return;
      }

      if (codeAction) {
        pendingLoginRequestId = id;
        sendEvent('needs_steam_guard', {
          is_email: codeAction.type === EAuthSessionGuardType.EmailCode,
        });
        return;
      }

      reply(id, false, { message: 'Unknown auth method required' });
      return;
    }

    // No action required — 'authenticated' will fire shortly.
    pendingLoginRequestId = id;
  } catch (err) {
    reply(id, false, { message: mapLoginError(err) });
  }
}

async function handleSubmitGuard(id, msg) {
  if (!loginSession || !pendingLoginRequestId) {
    reply(id, false, { message: 'No login session active' });
    return;
  }
  try {
    await loginSession.submitSteamGuardCode(msg.code || '');
    // 'authenticated' event will fire and complete the original login request.
    reply(id, true, { pending: true });
  } catch (err) {
    reply(id, false, { message: err.message || 'Steam Guard code rejected' });
  }
}

function handleStatus(id) {
  reply(id, true, {
    logged_in: !!(steamClient && steamClient.steamID),
    steam_id: steamClient && steamClient.steamID ? steamClient.steamID.toString() : null,
  });
}

function handleLogout(id) {
  try {
    if (steamClient) {
      try { steamClient.logOff(); } catch (e) {}
      steamClient = null;
    }
    loginSession = null;
    pendingLoginRequestId = null;
    reply(id, true, {});
  } catch (err) {
    reply(id, false, err);
  }
}

function handleGetOwnedGames(id) {
  if (!steamClient || !steamClient.steamID) {
    return reply(id, false, { message: 'Not logged in' });
  }
  steamClient.getUserOwnedApps(steamClient.steamID, {
    includePlayedFreeGames: true,
    includeFreeSub: false,
  }, (err, response) => {
    if (err) return reply(id, false, err);
    const games = (response.apps || []).map(app => ({
      app_id: app.appid,
      name: app.name || `App ${app.appid}`,
      playtime: app.playtime_forever || 0,
    }));
    reply(id, true, { games });
  });
}

function handleGetDepots(id, msg) {
  if (!steamClient) return reply(id, false, { message: 'Not logged in' });
  const appId = msg.app_id;
  steamClient.getProductInfo([appId], [], (err, apps) => {
    if (err) return reply(id, false, err);
    const appInfo = apps && apps[appId];
    if (!appInfo || !appInfo.appinfo) {
      return reply(id, false, { message: 'App info not found' });
    }
    const depots = appInfo.appinfo.depots || {};
    const depotList = [];

    for (const [depotIdStr, depotInfo] of Object.entries(depots)) {
      if (depotIdStr === 'branches' || !depotInfo || !depotInfo.manifests) continue;
      if (depotInfo.config && depotInfo.config.oslist && !depotInfo.config.oslist.includes('windows')) continue;

      const publicManifest = depotInfo.manifests.public;
      if (!publicManifest) continue;

      let manifestId;
      if (typeof publicManifest === 'string') {
        manifestId = publicManifest;
      } else if (typeof publicManifest === 'object') {
        if (publicManifest.gid) manifestId = String(publicManifest.gid);
        else {
          const keys = Object.keys(publicManifest);
          if (keys.length > 0) manifestId = String(publicManifest[keys[0]]);
          else continue;
        }
      } else {
        manifestId = String(publicManifest);
      }

      depotList.push({
        depot_id: parseInt(depotIdStr, 10),
        name: depotInfo.name || `Depot ${depotIdStr}`,
        manifest_id: manifestId,
        max_size: depotInfo.maxsize ? parseInt(depotInfo.maxsize, 10) : 0,
      });
    }

    depotList.sort((a, b) => b.max_size - a.max_size);
    reply(id, true, {
      app_name: (appInfo.appinfo.common && appInfo.appinfo.common.name) || `App ${appId}`,
      depots: depotList,
    });
  });
}

async function handleDumpApp(id, msg) {
  if (!steamClient) return reply(id, false, { message: 'Not logged in' });

  const appId = msg.app_id;
  const outputDir = msg.output_dir;
  if (!outputDir) return reply(id, false, { message: 'output_dir required' });

  try {
    // Best-effort free license request — silently ignore failure.
    await new Promise((resolve) => {
      try {
        steamClient.requestFreeLicense([appId], () => resolve());
      } catch (e) { resolve(); }
    });

    // Look up depots for this app.
    const productInfo = await new Promise((resolve, reject) => {
      steamClient.getProductInfo([appId], [], (err, apps) => {
        if (err) return reject(err);
        if (!apps || !apps[appId]) return reject(new Error('App info not found'));
        resolve(apps[appId]);
      });
    });

    const appName = (productInfo.appinfo && productInfo.appinfo.common && productInfo.appinfo.common.name) || `App ${appId}`;
    const depotsRaw = (productInfo.appinfo && productInfo.appinfo.depots) || {};

    // Collect Windows depots with public manifests.
    const candidateDepots = [];
    for (const [depotIdStr, depotInfo] of Object.entries(depotsRaw)) {
      if (depotIdStr === 'branches' || !depotInfo || !depotInfo.manifests) continue;
      if (depotInfo.config && depotInfo.config.oslist && !depotInfo.config.oslist.includes('windows')) continue;

      const publicManifest = depotInfo.manifests.public;
      if (!publicManifest) continue;

      let manifestId;
      if (typeof publicManifest === 'string') manifestId = publicManifest;
      else if (publicManifest.gid) manifestId = String(publicManifest.gid);
      else continue;

      candidateDepots.push({
        depot_id: parseInt(depotIdStr, 10),
        manifest_id: manifestId,
        max_size: depotInfo.maxsize ? parseInt(depotInfo.maxsize, 10) : 0,
      });
    }

    if (candidateDepots.length === 0) {
      return reply(id, false, { message: 'No dumpable Windows depots found for this app' });
    }

    candidateDepots.sort((a, b) => b.max_size - a.max_size);

    // The host already provides a fully-resolved per-app directory.
    const exportDir = outputDir;
    if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

    const luaLines = [`-- ${appName} (${appId})`, `addappid(${appId})`];
    const dumpedFiles = [];
    const errors = [];

    for (const depot of candidateDepots) {
      try {
        const depotKey = await new Promise((resolve, reject) => {
          steamClient.getDepotDecryptionKey(appId, depot.depot_id, (err, key) => {
            if (err) reject(err); else resolve(key);
          });
        });

        const rawManifest = await new Promise((resolve, reject) => {
          steamClient.getRawManifest(appId, depot.depot_id, depot.manifest_id, (err, data) => {
            if (err) reject(err); else resolve(data);
          });
        });

        const keyHex = Buffer.isBuffer(depotKey) ? depotKey.toString('hex').toUpperCase() : String(depotKey);
        const fileBase = `${depot.depot_id}_${depot.manifest_id}`;
        const manifestPath = path.join(exportDir, `${fileBase}.manifest`);
        fs.writeFileSync(manifestPath, rawManifest);
        dumpedFiles.push(`${fileBase}.manifest`);

        luaLines.push(`addappid(${depot.depot_id},1,"${keyHex}")`);
        luaLines.push(`setManifestid(${depot.depot_id},"${depot.manifest_id}",0)`);
      } catch (err) {
        errors.push(`Depot ${depot.depot_id}: ${err.message || err}`);
      }
    }

    if (dumpedFiles.length === 0) {
      return reply(id, false, { message: 'All depot dumps failed: ' + errors.join('; ') });
    }

    const luaPath = path.join(exportDir, `${appId}.lua`);
    fs.writeFileSync(luaPath, luaLines.join('\n') + '\n');
    dumpedFiles.push(`${appId}.lua`);

    reply(id, true, {
      app_id: appId,
      app_name: appName,
      output_dir: exportDir,
      depots_dumped: candidateDepots.length - errors.length,
      depots_failed: errors.length,
      files: dumpedFiles,
      errors,
    });
  } catch (err) {
    reply(id, false, err);
  }
}

async function dispatch(msg) {
  const { id, cmd } = msg;
  switch (cmd) {
    case 'ping':            return reply(id, true, { pong: true });
    case 'login':           return handleLogin(id, msg);
    case 'submit_guard':    return handleSubmitGuard(id, msg);
    case 'status':          return handleStatus(id);
    case 'logout':          return handleLogout(id);
    case 'get_owned_games': return handleGetOwnedGames(id);
    case 'get_depots':      return handleGetDepots(id, msg);
    case 'dump_app':        return handleDumpApp(id, msg);
    default:                return reply(id, false, { message: `Unknown command: ${cmd}` });
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch (err) {
    sendEvent('parse_error', { error: err.message });
    return;
  }
  Promise.resolve()
    .then(() => dispatch(msg))
    .catch((err) => {
      if (msg && typeof msg.id === 'number') {
        reply(msg.id, false, err);
      } else {
        sendEvent('dispatch_error', { error: err.message || String(err) });
      }
    });
});

rl.on('close', () => {
  if (steamClient) {
    try { steamClient.logOff(); } catch (e) {}
  }
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  sendEvent('uncaught_exception', { error: err.message, stack: err.stack });
});

sendEvent('ready', { version: '1.0.0' });
