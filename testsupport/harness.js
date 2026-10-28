// Test harness: runs the REAL routes/middleware/services on a tiny Express stand-in
// with an in-memory store and fake models (express/mongoose are not installable
// in the offline sandbox this was developed in).
const Module = require('module');
const path = require('path');
const createMemoryStore = require('../services/stores/memoryJobStore');

function makeShim() {
  function Router() {
    const stack = [];
    const r = (req, res, next) => r.handle(req, res, next);
    r.stack = stack;
    const add = (method, args) => {
      let p = '/', fns = args;
      if (typeof args[0] === 'string') { p = args[0]; fns = args.slice(1); }
      const keys = []; const rx = new RegExp('^' + p.replace(/:([A-Za-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + (method ? '/?$' : ''));
      fns.forEach(fn => stack.push({ method, rx, keys, fn, isUse: method === null, prefix: p }));
    };
    r.use = (...a) => {
      if (typeof a[0] === 'string') { const prefix = a[0]; a.slice(1).forEach(fn => stack.push({ method: null, prefix, fn, isUse: true })); }
      else a.forEach(fn => stack.push({ method: null, prefix: '', fn, isUse: true }));
    };
    ['get', 'post', 'patch', 'put', 'delete'].forEach(m => { r[m] = (...a) => add(m.toUpperCase(), a); });
    r.handle = (req, res, out) => {
      let i = 0;
      const next = err => {
        const layer = stack[i++];
        if (!layer) return out && out(err);
        try {
          if (layer.isUse) {
            if (!req.url.startsWith(layer.prefix)) return next(err);
            const saved = req.url; req.url = req.url.slice(layer.prefix.length) || '/';
            const done = e => { req.url = saved; next(e); };
            if (layer.fn.handle) return layer.fn.handle(req, res, done);
            return layer.fn.length === 4 ? (err ? layer.fn(err, req, res, done) : done()) : layer.fn(req, res, done);
          }
          if (err) return next(err);
          if (layer.method !== req.method) return next();
          const m = layer.rx.exec(req.url.split('?')[0]); if (!m) return next();
          req.params = {}; layer.keys.forEach((k, n) => { req.params[k] = decodeURIComponent(m[n + 1]); });
          const ret = layer.fn(req, res, next);
          if (ret && ret.catch) ret.catch(next);
        } catch (e) { next(e); }
      };
      next();
    };
    return r;
  }
  const express = () => ({ use() {}, get() {} });
  express.Router = Router;
  return express;
}

function install({ users = {}, models = {} } = {}) {
  const store = createMemoryStore();
  const express = makeShim();
  const fakeModels = {
    User: { findById: id => ({ select: () => Promise.resolve(users[id] || null) }) },
    ...models
  };
  const multer = () => ({ array: () => (req, res, next) => { req.files = req._files || []; next(); } });
  multer.memoryStorage = () => ({});
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'express') return express;
    if (request === 'multer') return multer;
    if (request === 'jsonwebtoken') return { verify: t => { if (!users[t]) throw new Error('bad token'); return { id: t }; } };
    if (request === 'mongoose' || request === 'bcryptjs') return { Schema: function () {}, model() {}, models: {} };
    if (/(^|[\\/])models$/.test(request)) return fakeModels;
    const resolved = (() => { try { return Module._resolveFilename(request, parent); } catch (_) { return ''; } })();
    if (resolved.endsWith(path.join('stores', 'mongoJobStore.js'))) return store;
    return origLoad.apply(this, arguments);
  };
  process.env.JWT_SECRET = 'test';
  return { store, express, restore: () => { Module._load = origLoad; } };
}

/** Call a router with a fake request; resolves {status, body}. */
function call(router, method, url, { token, body, files } = {}) {
  return new Promise(resolve => {
    const req = { method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, body: body || {}, _files: files,
      query: Object.fromEntries(new URL('http://x' + url).searchParams) };
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); } };
    router.handle(req, res, err => resolve({ status: err ? 500 : 404, body: { success: false, message: err ? err.message : 'no route' } }));
  });
}

module.exports = { install, call };
