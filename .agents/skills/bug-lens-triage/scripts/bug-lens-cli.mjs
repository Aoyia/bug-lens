#!/usr/bin/env node
import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
import { existsSync as ye, realpathSync as Pt } from "node:fs";
import { resolve as Tn } from "node:path";
import { fileURLToPath as Rn } from "node:url";
function $(e, t = 24e3, r) {
  let n = typeof t == "number" && t > 200 ? Math.floor(t) : 24e3;
  if (e.length <= n) return e;
  let s = r
      ? ` ${r}`
      : " Pass a larger maxChars or narrower filter/jsonPath to inspect further.",
    a = `

\u2026 [Truncated to ${n} chars (original ${e.length} chars).${s}]`,
    i = Math.max(100, n - a.length),
    l = e.slice(0, i),
    o = l.lastIndexOf(`
`),
    u = o > i * 0.75 ? o : i;
  return l.slice(0, u).trimEnd() + a;
}
import { createRequire as Ft } from "module";
var Lt = Ft("/"),
  Z,
  jt,
  _t;
try {
  ((Z = Lt("worker_threads")),
    (jt = Z.Worker),
    (_t = Z.isMarkedAsUntransferable));
} catch {}
var T = Uint8Array,
  K = Uint16Array,
  Dt = Int32Array,
  We = new T([
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5,
    5, 5, 5, 0, 0, 0, 0,
  ]),
  Ge = new T([
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10,
    11, 11, 12, 12, 13, 13, 0, 0,
  ]),
  zt = new T([
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
  ]),
  Ke = function (e, t) {
    for (var r = new K(31), n = 0; n < 31; ++n) r[n] = t += 1 << e[n - 1];
    for (var s = new Dt(r[30]), n = 1; n < 30; ++n)
      for (var a = r[n]; a < r[n + 1]; ++a) s[a] = ((a - r[n]) << 5) | n;
    return { b: r, r: s };
  },
  Z = Ke(We, 2),
  Ze = Z.b,
  qt = Z.r;
((Ze[28] = 258), (qt[258] = 28));
var Ve = Ke(Ge, 0),
  Ut = Ve.b,
  Un = Ve.r,
  Ce = new K(32768);
for (k = 0; k < 32768; ++k)
  ((D = ((k & 43690) >> 1) | ((k & 21845) << 1)),
    (D = ((D & 52428) >> 2) | ((D & 13107) << 2)),
    (D = ((D & 61680) >> 4) | ((D & 3855) << 4)),
    (Ce[k] = (((D & 65280) >> 8) | ((D & 255) << 8)) >> 1));
var D,
  k,
  Y = function (e, t, r) {
    for (var n = e.length, s = 0, a = new K(t); s < n; ++s)
      e[s] && ++a[e[s] - 1];
    var i = new K(t);
    for (s = 1; s < t; ++s) i[s] = (i[s - 1] + a[s - 1]) << 1;
    var l;
    if (r) {
      l = new K(1 << t);
      var o = 15 - t;
      for (s = 0; s < n; ++s)
        if (e[s])
          for (
            var u = (s << 4) | e[s],
              c = t - e[s],
              f = i[e[s] - 1]++ << c,
              h = f | ((1 << c) - 1);
            f <= h;
            ++f
          )
            l[Ce[f] >> o] = u;
    } else
      for (l = new K(n), s = 0; s < n; ++s)
        e[s] && (l[s] = Ce[i[e[s] - 1]++] >> (15 - e[s]));
    return l;
  },
  ee = new T(288);
for (k = 0; k < 144; ++k) ee[k] = 8;
var k;
for (k = 144; k < 256; ++k) ee[k] = 9;
var k;
for (k = 256; k < 280; ++k) ee[k] = 7;
var k;
for (k = 280; k < 288; ++k) ee[k] = 8;
var k,
  Xe = new T(32);
for (k = 0; k < 32; ++k) Xe[k] = 5;
var k;
var Bt = Y(ee, 9, 1);
var Jt = Y(Xe, 5, 1),
  Se = function (e) {
    for (var t = e[0], r = 1; r < e.length; ++r) e[r] > t && (t = e[r]);
    return t;
  },
  j = function (e, t, r) {
    var n = (t / 8) | 0;
    return ((e[n] | (e[n + 1] << 8)) >> (t & 7)) & r;
  },
  $e = function (e, t) {
    var r = (t / 8) | 0;
    return (e[r] | (e[r + 1] << 8) | (e[r + 2] << 16)) >> (t & 7);
  },
  Ht = function (e) {
    return ((e + 7) / 8) | 0;
  },
  Me = function (e, t, r) {
    return (
      (t == null || t < 0) && (t = 0),
      (r == null || r > e.length) && (r = e.length),
      new T(e.subarray(t, r))
    );
  };
var Wt = [
    "unexpected EOF",
    "invalid block type",
    "invalid length/literal",
    "invalid distance",
    "stream finished",
    "no stream handler",
    ,
    "no callback",
    "invalid UTF-8 data",
    "extra field too long",
    "date not in range 1980-2099",
    "filename too long",
    "stream finishing",
    "invalid zip data",
  ],
  A = function (e, t, r) {
    var n = new Error(t || Wt[e]);
    if (
      ((n.code = e),
      Error.captureStackTrace && Error.captureStackTrace(n, A),
      !r)
    )
      throw n;
    return n;
  },
  Gt = function (e, t, r, n) {
    var s = e.length,
      a = n ? n.length : 0;
    if (!s || (t.f && !t.l)) return r || new T(0);
    var i = !r,
      l = i || t.i != 2,
      o = t.i;
    i && (r = new T(s * 3));
    var u = function (Be) {
        var Je = r.length;
        if (Be > Je) {
          var He = new T(Math.max(Je * 2, Be));
          (He.set(r), (r = He));
        }
      },
      c = t.f || 0,
      f = t.p || 0,
      h = t.b || 0,
      m = t.l,
      d = t.d,
      p = t.m,
      g = t.n,
      y = s * 8;
    do {
      if (!m) {
        c = j(e, f, 1);
        var v = j(e, f + 1, 3);
        if (((f += 3), v))
          if (v == 1) ((m = Bt), (d = Jt), (p = 9), (g = 5));
          else if (v == 2) {
            var b = j(e, f, 31) + 257,
              I = j(e, f + 10, 15) + 4,
              P = b + j(e, f + 5, 31) + 1;
            f += 14;
            for (var L = new T(P), H = new T(19), R = 0; R < I; ++R)
              H[zt[R]] = j(e, f + R * 3, 7);
            f += I * 3;
            for (
              var je = Se(H), It = (1 << je) - 1, At = Y(H, je, 1), R = 0;
              R < P;
            ) {
              var _e = At[j(e, f, It)];
              f += _e & 15;
              var x = _e >> 4;
              if (x < 16) L[R++] = x;
              else {
                var W = 0,
                  se = 0;
                for (
                  x == 16
                    ? ((se = 3 + j(e, f, 3)), (f += 2), (W = L[R - 1]))
                    : x == 17
                      ? ((se = 3 + j(e, f, 7)), (f += 3))
                      : x == 18 && ((se = 11 + j(e, f, 127)), (f += 7));
                  se--;
                )
                  L[R++] = W;
              }
            }
            var De = L.subarray(0, b),
              q = L.subarray(b);
            ((p = Se(De)), (g = Se(q)), (m = Y(De, p, 1)), (d = Y(q, g, 1)));
          } else A(1);
        else {
          var x = Ht(f) + 4,
            w = e[x - 4] | (e[x - 3] << 8),
            S = x + w;
          if (S > s) {
            o && A(0);
            break;
          }
          (l && u(h + w),
            r.set(e.subarray(x, S), h),
            (t.b = h += w),
            (t.p = f = S * 8),
            (t.f = c));
          continue;
        }
        if (f > y) {
          o && A(0);
          break;
        }
      }
      l && u(h + 131072);
      for (var Tt = (1 << p) - 1, Rt = (1 << g) - 1, ve = f; ; ve = f) {
        var W = m[$e(e, f) & Tt],
          G = W >> 4;
        if (((f += W & 15), f > y)) {
          o && A(0);
          break;
        }
        if ((W || A(2), G < 256)) r[h++] = G;
        else if (G == 256) {
          ((ve = f), (m = null));
          break;
        } else {
          var ze = G - 254;
          if (G > 264) {
            var R = G - 257,
              Q = We[R];
            ((ze = j(e, f, (1 << Q) - 1) + Ze[R]), (f += Q));
          }
          var xe = d[$e(e, f) & Rt],
            we = xe >> 4;
          (xe || A(3), (f += xe & 15));
          var q = Ut[we];
          if (we > 3) {
            var Q = Ge[we];
            ((q += $e(e, f) & ((1 << Q) - 1)), (f += Q));
          }
          if (f > y) {
            o && A(0);
            break;
          }
          l && u(h + 131072);
          var qe = h + ze;
          if (h < q) {
            var Ue = a - q,
              Ot = Math.min(q, qe);
            for (Ue + h < 0 && A(3); h < Ot; ++h) r[h] = n[Ue + h];
          }
          for (; h < qe; ++h) r[h] = r[h - q];
        }
      }
      ((t.l = m),
        (t.p = ve),
        (t.b = h),
        (t.f = c),
        m && ((c = 1), (t.m = p), (t.d = d), (t.n = g)));
    } while (!c);
    return h != r.length && i ? Me(r, 0, h) : r.subarray(0, h);
  };
var Kt = new T(0);
var _ = function (e, t) {
    return e[t] | (e[t + 1] << 8);
  },
  O = function (e, t) {
    return (e[t] | (e[t + 1] << 8) | (e[t + 2] << 16) | (e[t + 3] << 24)) >>> 0;
  },
  ke = function (e, t) {
    return O(e, t) + O(e, t + 4) * 4294967296;
  };
function Zt(e, t) {
  return Gt(e, { i: 2 }, t && t.out, t && t.dictionary);
}
var be = typeof TextDecoder < "u" && new TextDecoder(),
  Vt = 0;
try {
  (be.decode(Kt, { stream: !0 }), (Vt = 1));
} catch {}
var Xt = function (e) {
  for (var t = "", r = 0; ;) {
    var n = e[r++],
      s = (n > 127) + (n > 223) + (n > 239);
    if (r + s > e.length) return { s: t, r: Me(e, r - 1) };
    s
      ? s == 3
        ? ((n =
            (((n & 15) << 18) |
              ((e[r++] & 63) << 12) |
              ((e[r++] & 63) << 6) |
              (e[r++] & 63)) -
            65536),
          (t += String.fromCharCode(55296 | (n >> 10), 56320 | (n & 1023))))
        : s & 1
          ? (t += String.fromCharCode(((n & 31) << 6) | (e[r++] & 63)))
          : (t += String.fromCharCode(
              ((n & 15) << 12) | ((e[r++] & 63) << 6) | (e[r++] & 63)
            ))
      : (t += String.fromCharCode(n));
  }
};
function Qt(e, t) {
  if (t) {
    for (var r = "", n = 0; n < e.length; n += 16384)
      r += String.fromCharCode.apply(null, e.subarray(n, n + 16384));
    return r;
  } else {
    if (be) return be.decode(e);
    var s = Xt(e),
      a = s.s,
      r = s.r;
    return (r.length && A(8), a);
  }
}
var Yt = function (e, t) {
    return t + 30 + _(e, t + 26) + _(e, t + 28);
  },
  en = function (e, t, r) {
    var n = _(e, t + 28),
      s = _(e, t + 30),
      a = Qt(e.subarray(t + 46, t + 46 + n), !(_(e, t + 8) & 2048)),
      i = t + 46 + n,
      l = tn(e, i, s, r, O(e, t + 20), O(e, t + 24), O(e, t + 42)),
      o = l[0],
      u = l[1],
      c = l[2];
    return [_(e, t + 10), o, u, a, i + s + _(e, t + 32), c];
  },
  tn = function (e, t, r, n, s, a, i) {
    var l = s == 4294967295,
      o = a == 4294967295,
      u = i == 4294967295,
      c = t + r,
      f = l + o + u;
    if (n && f) {
      for (; t + 4 < c; t += 4 + _(e, t + 2))
        if (_(e, t) == 1)
          return [
            l ? ke(e, t + 4 + 8 * o) : s,
            o ? ke(e, t + 4) : a,
            u ? ke(e, t + 4 + 8 * (o + l)) : i,
            1,
          ];
      n < 2 && A(13);
    }
    return [s, a, i, 0];
  };
function Qe(e, t) {
  for (var r = {}, n = e.length - 22; O(e, n) != 101010256; --n)
    (!n || e.length - n > 65558) && A(13);
  var s = _(e, n + 8);
  if (!s) return {};
  var a = O(e, n + 16),
    i = O(e, n - 20) == 117853008;
  if (i) {
    var l = O(e, n - 12);
    ((i = O(e, l) == 101075792), i && ((s = O(e, l + 32)), (a = O(e, l + 48))));
  }
  for (var o = t && t.filter, u = 0; u < s; ++u) {
    var c = en(e, a, i),
      f = c[0],
      h = c[1],
      m = c[2],
      d = c[3],
      p = c[4],
      g = c[5],
      y = Yt(e, g);
    ((a = p),
      (!o || o({ name: d, size: h, originalSize: m, compression: f })) &&
        (f
          ? f == 8
            ? (r[d] = Zt(e.subarray(y, y + h), { out: new T(m) }))
            : A(14, "unknown compression type " + f)
          : (r[d] = Me(e, y, y + h))));
  }
  return r;
}
import {
  existsSync as sn,
  mkdirSync as Ee,
  readdirSync as on,
  readFileSync as Pe,
  realpathSync as an,
  rmSync as Yn,
  statSync as ot,
  writeFileSync as it,
} from "node:fs";
import { tmpdir as cn } from "node:os";
import {
  dirname as at,
  join as ce,
  posix as ln,
  resolve as B,
  sep as rt,
} from "node:path";
var oe = class {
  maxEntries;
  map = new Map();
  constructor(t = 3) {
    this.maxEntries = t;
  }
  get(t, r) {
    let n = this.map.get(t);
    if (n) {
      if (n.fingerprint !== r) {
        this.map.delete(t);
        return;
      }
      return (this.map.delete(t), this.map.set(t, n), n.pack);
    }
  }
  set(t, r, n) {
    if (this.map.has(t)) this.map.delete(t);
    else if (this.map.size >= this.maxEntries) {
      let s = this.map.keys().next().value;
      s !== void 0 && this.map.delete(s);
    }
    this.map.set(t, { fingerprint: r, pack: n });
  }
  getLastPath() {
    let t;
    for (let r of this.map.keys()) t = r;
    return t;
  }
  clear() {
    this.map.clear();
  }
};
var nn = /^\s*(?:window|globalThis)\.__BUG_LENS_[A-Z0-9_]+__\s*=\s*/;
function V(e, t = "js-data") {
  let r = nn.exec(e);
  if (!r)
    throw new Error(
      `INVALID_JS_JSON_WRAPPER: ${t} does not start with expected window.__BUG_LENS_*__ assignment`
    );
  let n = e.slice(r[0].length).trim();
  n.endsWith(";") && (n = n.slice(0, -1).trimEnd());
  try {
    return JSON.parse(n);
  } catch (s) {
    let a = s instanceof Error ? s.message : String(s);
    throw new Error(
      `INVALID_JS_JSON_PAYLOAD: Failed to parse JSON in ${t}: ${a}`
    );
  }
}
import { createHash as rn } from "node:crypto";
var Ye = [1, 2, 3, 4],
  et = 4;
function tt(e) {
  if (e)
    try {
      let t = new TextDecoder().decode(e);
      return JSON.parse(t);
    } catch {
      return;
    }
}
function nt(e, t, r) {
  if (!e)
    return {
      hasManifest: !1,
      valid: !0,
      checkedCount: 0,
      skippedCount: r.size,
      mismatches: [],
    };
  let n = e.schemaVersion,
    s;
  typeof n == "number" &&
    !Ye.includes(n) &&
    (n > et
      ? (s = `Package schemaVersion (${n}) is newer than max supported version (${et}). Reading in best-effort mode; please upgrade bug-lens-mcp if fields are missing.`)
      : (s = `Package schemaVersion (${n}) is not in standard supported list (${Ye.join(", ")}). Reading in best-effort mode.`));
  let a = e.files ?? {},
    i = 0,
    l = 0,
    o = [];
  for (let [u, c] of Object.entries(a)) {
    if (r.has(u)) {
      l += 1;
      continue;
    }
    let f = t.get(u);
    if (!f) {
      o.push(`${u}: missing in archive`);
      continue;
    }
    if (
      ((i += 1),
      typeof c.byteLength == "number" && f.byteLength !== c.byteLength)
    ) {
      o.push(
        `${u}: byteLength mismatch (expected ${c.byteLength}, got ${f.byteLength})`
      );
      continue;
    }
    typeof c.sha256 == "string" &&
      c.sha256.length > 0 &&
      rn("sha256").update(f).digest("hex").toLowerCase() !==
        c.sha256.toLowerCase() &&
      o.push(`${u}: sha256 mismatch`);
  }
  return {
    hasManifest: !0,
    valid: o.length === 0,
    schemaVersion: n,
    schemaWarning: s,
    checkedCount: i,
    skippedCount: l,
    mismatches: o,
  };
}
var ie = class {
  kind = "screenshot";
  packPath;
  manifest;
  integrity;
  domContext;
  environment;
  cascade;
  aiPrompt;
  files;
  skippedMediaFiles;
  textDecoder = new TextDecoder();
  constructor(t) {
    ((this.packPath = t.packPath),
      (this.manifest = t.manifest),
      (this.integrity = t.integrity),
      (this.domContext = t.domContext),
      (this.environment = t.environment),
      (this.cascade = t.cascade),
      (this.aiPrompt = t.aiPrompt),
      (this.files = t.files),
      (this.skippedMediaFiles = t.skippedMediaFiles));
  }
  getScreenshotImagePath() {
    for (let t of [
      "screenshot.jpg",
      "screenshot.png",
      "screenshot.jpeg",
      "screenshot.webp",
    ])
      if (this.files.has(t)) return t;
  }
  getTextFile(t) {
    let r = t.replace(/^\.?\//, ""),
      n = this.files.get(r);
    if (n) return this.textDecoder.decode(n);
  }
  getBinaryFile(t) {
    let r = t.replace(/^\.?\//, "");
    return this.files.get(r);
  }
  listFiles() {
    let t = [];
    for (let [r, n] of this.files.entries())
      t.push({ path: r, byteLength: n.byteLength });
    for (let [r, n] of this.skippedMediaFiles.entries())
      t.push({ path: r, byteLength: n.originalSize, skippedMedia: !0 });
    return t.sort((r, n) => r.path.localeCompare(n.path));
  }
};
var ae = class {
  kind = "session";
  packPath;
  manifest;
  integrity;
  data;
  t0EpochMs;
  files;
  skippedMediaFiles;
  networkDetailsCache;
  textDecoder = new TextDecoder();
  constructor(t) {
    ((this.packPath = t.packPath),
      (this.manifest = t.manifest),
      (this.integrity = t.integrity),
      (this.data = t.data),
      (this.files = t.files),
      (this.skippedMediaFiles = t.skippedMediaFiles));
    let r = t.data.session?.timeline,
      n = t.data.interactions?.[0]?.createdAt;
    this.t0EpochMs = r?.startedAtEpochMs ?? r?.createdAtEpochMs ?? n ?? 0;
  }
  get sessionId() {
    return (
      this.data.session?.id ??
      this.manifest?.sessionId ??
      this.data.interactions?.[0]?.sessionId ??
      "unknown"
    );
  }
  toRelativeMs(t) {
    if (!(typeof t != "number" || !Number.isFinite(t)))
      return this.t0EpochMs <= 0 ? t : t - this.t0EpochMs;
  }
  toEpochMs(t) {
    return this.t0EpochMs + t;
  }
  getConsoleEntries() {
    return this.data.consoleEntries ?? this.data.consoleLogs ?? [];
  }
  getInteractions() {
    return this.data.interactions ?? [];
  }
  getNetworkEntries() {
    return this.data.networkEntries ?? [];
  }
  getFrameworkStates() {
    return this.data.frameworkStates ?? [];
  }
  getIssueScenes() {
    return (this.data.issueScenes ?? []).map((r, n) => {
      let s = r.scene ?? {
          id: r.id,
          narrative: r.narrative,
          sequenceContext: r.sequenceContext,
          target: r.target,
          targets: r.targets,
        },
        a = s.id ?? r.id ?? `scene-${n + 1}`,
        i = r.originalSource ?? this.findSceneImagePath(a, "original"),
        l = r.annotatedSource ?? this.findSceneImagePath(a, "annotated");
      return {
        id: a,
        index: n,
        scene: s,
        originalSource: i,
        annotatedSource: l,
      };
    });
  }
  findSceneImagePath(t, r) {
    for (let n of ["jpg", "png", "jpeg", "webp"]) {
      let s = `issues/${t}/screenshot-${r}.${n}`;
      if (this.files.has(s)) return s;
    }
  }
  getNetworkDetails() {
    if (this.networkDetailsCache) return this.networkDetailsCache;
    let t = this.files.get("data/network-details.js");
    if (!t) return ((this.networkDetailsCache = {}), this.networkDetailsCache);
    try {
      let r = this.textDecoder.decode(t);
      this.networkDetailsCache = V(r, "data/network-details.js");
    } catch {
      this.networkDetailsCache = {};
    }
    return this.networkDetailsCache;
  }
  getNetworkBody(t) {
    if (typeof t.response?.body == "string") return t.response.body;
    let r = t.response?.bodyPath;
    if (r) {
      let s = this.getTextFile(r);
      if (s !== void 0) return s;
    }
    let n = t.id.replace(/[^a-zA-Z0-9._-]/g, "_");
    return (
      this.getTextFile(`network/body-${n}.txt`) ??
      this.getTextFile(`network/body-${t.id}.txt`)
    );
  }
  getTextFile(t) {
    let r = t.replace(/^\.?\//, ""),
      n = this.files.get(r);
    if (n) return this.textDecoder.decode(n);
  }
  getBinaryFile(t) {
    let r = t.replace(/^\.?\//, "");
    return this.files.get(r);
  }
  listFiles() {
    let t = [];
    for (let [r, n] of this.files.entries())
      t.push({ path: r, byteLength: n.byteLength });
    for (let [r, n] of this.skippedMediaFiles.entries())
      t.push({ path: r, byteLength: n.originalSize, skippedMedia: !0 });
    return t.sort((r, n) => r.path.localeCompare(n.path));
  }
};
var te = 64 * 1024 * 1024,
  ne = 512 * 1024 * 1024,
  ct = /(?:^|\/)media\/|\.(?:mp4|webm|mkv|mov)$/i,
  un = /[:*?"<>|]/g,
  fn = new oe(3);
function le() {
  let e =
    process.env.BUG_LENS_WORKSPACE_DIR || process.env.BUG_LENS_CLI_WORKSPACE;
  return e ? B(e) : ce(cn(), "bug-lens-workspace");
}
function lt() {
  return ce(le(), ".current-pack");
}
function st(e) {
  try {
    let t = lt();
    (Ee(at(t), { recursive: !0 }), it(t, e, "utf8"));
  } catch {}
}
function hn() {
  try {
    let e = lt();
    if (sn(e)) {
      let t = Pe(e, "utf8").trim();
      if (t.length > 0) return t;
    }
  } catch {}
}
function Ne(e) {
  let t = e.replace(/\\/g, "/").replace(/^\.?\//, ""),
    r = ln.normalize(t);
  if (
    r.startsWith("/") ||
    r === ".." ||
    r.startsWith("../") ||
    r.includes("/../") ||
    /^[a-zA-Z]:/.test(r)
  )
    throw new Error(
      `UNSAFE_ZIP_ENTRY_PATH: Refusing archive entry with traversal or absolute path: ${e}`
    );
  return r;
}
function dn(e) {
  let t = new Map(),
    r = 0,
    n;
  try {
    n = Qe(e, {
      filter(i) {
        let l = Ne(i.name);
        if (l.endsWith("/")) return !1;
        let o = i.originalSize ?? 0,
          u = i.size ?? 0;
        if (ct.test(l))
          return (t.set(l, { originalSize: o, compressedSize: u }), !1);
        if (o > te)
          throw new Error(
            `ZIP_BOMB_SINGLE_FILE_EXCEEDED: Entry "${l}" uncompressed size (${o} bytes) exceeds limit (${te} bytes)`
          );
        if (((r += o), r > ne))
          throw new Error(
            `ZIP_BOMB_TOTAL_SIZE_EXCEEDED: Total uncompressed size (${r} bytes) exceeds limit (${ne} bytes)`
          );
        return !0;
      },
    });
  } catch (i) {
    if (
      i instanceof Error &&
      (i.message.startsWith("ZIP_BOMB_") ||
        i.message.startsWith("UNSAFE_ZIP_ENTRY_PATH:"))
    )
      throw i;
    let l = i instanceof Error ? i.message : String(i);
    throw new Error(`CORRUPT_ZIP_ARCHIVE: Failed to decompress ZIP: ${l}`);
  }
  let s = new Map(),
    a = 0;
  for (let [i, l] of Object.entries(n)) {
    let o = Ne(i);
    if (!o.endsWith("/")) {
      if (l.byteLength > te)
        throw new Error(
          `ZIP_BOMB_SINGLE_FILE_EXCEEDED: Decompressed "${o}" (${l.byteLength} bytes) exceeds limit (${te} bytes)`
        );
      if (((a += l.byteLength), a > ne))
        throw new Error(
          `ZIP_BOMB_TOTAL_SIZE_EXCEEDED: Total decompressed size (${a} bytes) exceeds limit (${ne} bytes)`
        );
      s.set(o, l);
    }
  }
  return { files: s, skippedMediaFiles: t };
}
function pn(e) {
  let t = new Map(),
    r = new Map(),
    n = 0;
  function s(a, i) {
    for (let l of on(a, { withFileTypes: !0 })) {
      let o = i ? `${i}/${l.name}` : l.name,
        u = ce(a, l.name);
      if (l.isDirectory()) s(u, o);
      else if (l.isFile()) {
        let c = ot(u);
        if (ct.test(o)) {
          r.set(o, { originalSize: c.size, compressedSize: c.size });
          continue;
        }
        if (c.size > te)
          throw new Error(
            `ZIP_BOMB_SINGLE_FILE_EXCEEDED: File "${o}" (${c.size} bytes) exceeds limit`
          );
        if (((n += c.size), n > ne))
          throw new Error(
            `ZIP_BOMB_TOTAL_SIZE_EXCEEDED: Total size (${n} bytes) exceeds limit`
          );
        t.set(o, new Uint8Array(Pe(u)));
      }
    }
  }
  return (s(e, ""), { files: t, skippedMediaFiles: r });
}
function M(e, t = fn) {
  let r =
    e && typeof e == "string" && e.trim().length > 0
      ? e.trim()
      : (t.getLastPath() ?? hn());
  if (!r)
    throw new Error(
      'INVALID_PACK_PATH: pack path is required when no pack has been opened yet. Pass the "pack" argument or call open_pack first.'
    );
  let n = B(r),
    s,
    a;
  try {
    ((s = an(n)), (a = ot(s)));
  } catch (f) {
    let h = f instanceof Error ? f.message : String(f);
    throw new Error(`PACK_NOT_FOUND: Cannot access "${r}": ${h}`);
  }
  let i = `${a.isDirectory() ? "dir" : "file"}:${a.mtimeMs}:${a.size}`,
    l = t.get(s, i);
  if (l) return (st(s), l);
  let { files: o, skippedMediaFiles: u } = a.isDirectory()
      ? pn(s)
      : dn(new Uint8Array(Pe(s))),
    c = mn(s, o, u);
  return (t.set(s, i, c), st(s), c);
}
function mn(e, t, r) {
  let n = new TextDecoder(),
    s = tt(t.get("manifest.json")),
    a = new Set(r.keys()),
    i = nt(s, t, a),
    l = t.get("data/session-data.js");
  if (l) {
    let c = n.decode(l),
      f = V(c, "data/session-data.js");
    return new ae({
      packPath: e,
      manifest: s,
      integrity: i,
      data: f,
      files: t,
      skippedMediaFiles: r,
    });
  }
  if (
    t.has("dom-context.json") ||
    t.has("screenshot.jpg") ||
    t.has("screenshot.png") ||
    t.has("ai-prompt.md")
  ) {
    let c = (g) => {
        let y = t.get(g);
        if (y)
          try {
            return JSON.parse(n.decode(y));
          } catch (v) {
            let x = v instanceof Error ? v.message : String(v);
            throw new Error(`INVALID_JSON_FILE: Failed to parse ${g}: ${x}`);
          }
      },
      f = c("dom-context.json"),
      h = c("environment.json"),
      m = c("cascade.json"),
      d = t.get("ai-prompt.md"),
      p = d ? n.decode(d) : void 0;
    return new ie({
      packPath: e,
      manifest: s,
      integrity: i,
      domContext: f,
      environment: h,
      cascade: m,
      aiPrompt: p,
      files: t,
      skippedMediaFiles: r,
    });
  }
  let u = Array.from(t.keys()).slice(0, 10).join(", ");
  throw new Error(
    `UNRECOGNIZED_BUG_LENS_PACK: Archive does not contain "data/session-data.js" or "dom-context.json". Found files: [${u}]`
  );
}
function Ie(e) {
  let t = Ne(e),
    n = t
      .split("/")
      .map((s) => s.replace(un, "_").replace(/[. ]+$/, "_"))
      .join("/");
  return { sanitized: n, renamed: n !== t };
}
function ut(e, t) {
  let r =
      e.kind === "session"
        ? e.sessionId.slice(0, 8) || "session"
        : "screenshot",
    n = B(t ?? ce(le(), r));
  Ee(n, { recursive: !0 });
  let s = [],
    a = new Map();
  for (let m of e.files.keys()) {
    let { sanitized: d, renamed: p } = Ie(m);
    p && (s.push({ from: m, to: d }), a.set(m, d));
  }
  let i = [],
    l = new TextDecoder(),
    o = new TextEncoder();
  for (let [m, d] of e.files.entries()) {
    let p = a.get(m) ?? m,
      g = B(n, ...p.split("/")),
      y = n.endsWith(rt) ? n : n + rt;
    if (g !== n && !g.startsWith(y))
      throw new Error(
        `UNSAFE_ZIP_ENTRY_PATH: Target path escapes destination root: ${m}`
      );
    Ee(at(g), { recursive: !0 });
    let v = d;
    if (m === "data/session-data.js" && a.size > 0) {
      let x = l.decode(d);
      for (let [w, S] of a.entries()) x = x.split(w).join(S);
      v = o.encode(x);
    }
    (it(g, v), i.push(p));
  }
  let u = e.files.has("reproduce.spec.ts") ? B(n, "reproduce.spec.ts") : void 0,
    c = e.files.has("report.html") ? B(n, "report.html") : void 0,
    f = e.kind === "screenshot" ? e.getScreenshotImagePath() : void 0,
    h = f ? B(n, f) : void 0;
  return {
    destDir: n,
    writtenFiles: i.sort(),
    renamedPaths: s,
    reproduceSpecPath: u,
    reportHtmlPath: c,
    screenshotPath: h,
  };
}
function ft(e) {
  let t = M(e.pack),
    r = ut(t, e.dest);
  if (e.format === "json") return $(JSON.stringify(r, null, 2));
  let n = [];
  return (
    n.push("# Extracted Bug Lens Pack"),
    n.push(`- **Destination**: \`${r.destDir}\``),
    n.push(`- **Written Files**: ${r.writtenFiles.length}`),
    r.renamedPaths.length > 0 &&
      n.push(
        `- **Sanitized Filenames (Windows-safe)**: ${r.renamedPaths.length} file(s) had reserved characters (\`:\` etc.) replaced with \`_\` and references updated in \`data/session-data.js\`.`
      ),
    r.reproduceSpecPath &&
      (n.push(`- **Playwright Reproduction Spec**: \`${r.reproduceSpecPath}\``),
      n.push(
        `  - Run command: \`npx playwright test --headed "${r.reproduceSpecPath}"\``
      )),
    r.reportHtmlPath &&
      n.push(`- **Interactive HTML Report**: \`${r.reportHtmlPath}\``),
    r.screenshotPath &&
      n.push(`- **Screenshot File**: \`${r.screenshotPath}\``),
    n.join(`
`)
  );
}
function C(e) {
  if (typeof e != "number" || !Number.isFinite(e)) return "\u2014";
  let t = e >= 0 ? "+" : "-",
    r = Math.abs(e) / 1e3;
  return `${t}${r.toFixed(1)}s`;
}
function U(e) {
  return typeof e != "number" || !Number.isFinite(e)
    ? "\u2014"
    : e < 1e3
      ? `${Math.round(e)}ms`
      : `${(e / 1e3).toFixed(2)}s`;
}
function gn(e) {
  let t = e.trim().replace(/^\$\.?/, "");
  if (!t) return [];
  let r = [],
    n = /([^.[\]]+)|\[([^\]]+)\]/g,
    s;
  for (; (s = n.exec(t)) !== null;)
    if (s[1] !== void 0) r.push({ kind: "prop", key: s[1] });
    else if (s[2] !== void 0) {
      let a = s[2].trim();
      if (a === "*") r.push({ kind: "wildcard" });
      else if (/^-?\d+$/.test(a))
        r.push({ kind: "index", index: Number.parseInt(a, 10) });
      else {
        let i =
          /^(?:\?\(\s*)?(?:@\.)?([a-zA-Z0-9_$-]+)\s*={1,3}\s*(.+?)(?:\s*\))?$/.exec(
            a
          );
        if (i) {
          let l = i[1].trim(),
            o = i[2].trim().replace(/^['"]|['"]$/g, "");
          r.push({ kind: "filter", field: l, value: o });
        } else {
          let l = a.replace(/^['"]|['"]$/g, "");
          r.push({ kind: "prop", key: l });
        }
      }
    }
  return r;
}
function J(e, t) {
  let r = gn(t);
  if (r.length === 0) return e;
  let n = [e],
    s = !1;
  for (let a of r) {
    let i = [];
    for (let l of n)
      if (l != null) {
        if (a.kind === "prop") {
          if (typeof l == "object" && !Array.isArray(l)) {
            let o = l[a.key];
            o !== void 0 && i.push(o);
          }
        } else if (a.kind === "index") {
          if (Array.isArray(l)) {
            let o = a.index < 0 ? l.length + a.index : a.index;
            o >= 0 && o < l.length && i.push(l[o]);
          }
        } else if (a.kind === "wildcard")
          ((s = !0),
            Array.isArray(l)
              ? i.push(...l)
              : typeof l == "object" && i.push(...Object.values(l)));
        else if (a.kind === "filter" && ((s = !0), Array.isArray(l))) {
          for (let o of l)
            if (o && typeof o == "object") {
              let u = o[a.field];
              String(u) === a.value && i.push(o);
            }
        }
      }
    n = i;
  }
  return s ? n : n.length === 1 ? n[0] : n;
}
function Ae(e) {
  let t = [];
  return (
    e.snapshot?.targetComponent && t.push(e.snapshot.targetComponent),
    e.snapshot?.rootComponent && t.push(e.snapshot.rootComponent),
    Array.isArray(e.snapshot?.parentChain) && t.push(...e.snapshot.parentChain),
    Array.isArray(e.components) && t.push(...e.components),
    t
  );
}
function ht(e) {
  let t = M(e.pack);
  if (t.kind === "screenshot") {
    let c =
        t.environment?.frameworkComponentStates ??
        t.environment?.vueComponentStates ??
        [],
      f = e.component?.toLowerCase(),
      h = f
        ? c.filter((d) => (d.componentName ?? "").toLowerCase().includes(f))
        : c;
    if (e.path) return $(JSON.stringify(J(h, e.path), null, 2), e.maxChars);
    if (e.format === "json")
      return $(
        JSON.stringify({ totalComponents: c.length, components: h }, null, 2),
        e.maxChars
      );
    if (h.length === 0)
      return "No framework component states recorded in this screenshot pack.";
    let m = [
      `# Screenshot Pack Component States (${h.length} of ${c.length})`,
      ...h.map(
        (
          d
        ) => `- **${d.componentName ?? "Anonymous"}** (${d.framework ?? "vue/react"})${d.componentFile ? ` @ ${d.componentFile}:${d.componentLine ?? ""}` : ""}
  - props: ${JSON.stringify(d.props ?? {})}
  - data: ${JSON.stringify(d.data ?? d.state ?? {})}`
      ),
    ];
    return $(
      m.join(`
`),
      e.maxChars
    );
  }
  let r = t.getFrameworkStates();
  if (r.length === 0)
    return "No frameworkStates were captured in this session pack.";
  let n = e.index;
  if (n === void 0 && e.nearMs !== void 0) {
    let c = 0,
      f = 1 / 0;
    (r.forEach((h, m) => {
      let d = t.toRelativeMs(h.capturedAtEpochMs) ?? 0,
        p = Math.abs(d - e.nearMs);
      p < f && ((f = p), (c = m));
    }),
      (n = c));
  }
  let s = n ?? r.length - 1,
    a = r[s];
  if (!a)
    throw new Error(
      `FRAMEWORK_STATE_NOT_FOUND: Index ${s} out of range (0..${r.length - 1})`
    );
  if (e.path) {
    let c = J(a, e.path);
    return $(
      JSON.stringify(
        {
          stateIndex: s,
          relativeMs: t.toRelativeMs(a.capturedAtEpochMs),
          path: e.path,
          value: c,
        },
        null,
        2
      ),
      e.maxChars
    );
  }
  let i = e.component?.toLowerCase();
  if (e.format === "json")
    return $(
      JSON.stringify(
        {
          totalStates: r.length,
          overview: r.map((c, f) => ({
            index: f,
            relativeMs: t.toRelativeMs(c.capturedAtEpochMs),
            trigger: c.trigger,
            components: Ae(c)
              .map((h) => h.componentName)
              .filter(Boolean),
            localStorageKeys: Object.keys(c.webStorage?.localStorage ?? {}),
            sessionStorageKeys: Object.keys(c.webStorage?.sessionStorage ?? {}),
          })),
          selectedIndex: s,
          selectedState: a,
        },
        null,
        2
      ),
      e.maxChars
    );
  let l = [];
  (l.push(`# Framework States (${r.length} snapshots in pack)`),
    l.push(`
## Snapshot Index Overview`),
    r.forEach((c, f) => {
      let h = t.toRelativeMs(c.capturedAtEpochMs),
        m = Ae(c)
          .map((y) => y.componentName)
          .filter(Boolean),
        d = Object.keys(c.webStorage?.localStorage ?? {}),
        p = Object.keys(c.webStorage?.sessionStorage ?? {}),
        g = f === s ? " <-- [SELECTED]" : "";
      l.push(
        `- **[${f}]** ${C(h)} trigger=\`${c.trigger ?? "?"}\` | components=[${m.slice(0, 5).join(", ") || "none"}] | localStorageKeys=${d.length} | sessionStorageKeys=${p.length}${g}`
      );
    }));
  let o = t.toRelativeMs(a.capturedAtEpochMs);
  l.push(`
## Selected Snapshot [${s}] (at ${C(o)}, trigger=\`${a.trigger ?? "?"}\`)`);
  let u = Ae(a).filter((c) =>
    i ? (c.componentName ?? "").toLowerCase().includes(i) : !0
  );
  if (u.length > 0) {
    l.push(`
### Component Tree / Chain (${u.length})`);
    for (let c of u) {
      (l.push(
        `- **${c.componentName ?? "Anonymous"}** (${c.framework ?? "framework"} v${c.version ?? "?"})`
      ),
        c.props &&
          Object.keys(c.props).length > 0 &&
          l.push(`  - props: ${JSON.stringify(c.props)}`));
      let f = c.state ?? c.data;
      f &&
        Object.keys(f).length > 0 &&
        l.push(`  - state: ${JSON.stringify(f)}`);
    }
  } else
    l.push(`
### Component Tree
(No component tree recorded on snapshot [${s}])`);
  if (
    (a.globalState &&
      Object.keys(a.globalState).length > 0 &&
      (l.push(`
### Global State`),
      l.push(JSON.stringify(a.globalState, null, 2))),
    a.webStorage)
  ) {
    let c = a.webStorage;
    (l.push(`
### Web Storage (redactedValues: ${!!c.redactedValues})`),
      c.localStorage &&
        Object.keys(c.localStorage).length > 0 &&
        (l.push("#### localStorage"),
        l.push(JSON.stringify(c.localStorage, null, 2))),
      c.sessionStorage &&
        Object.keys(c.sessionStorage).length > 0 &&
        (l.push("#### sessionStorage"),
        l.push(JSON.stringify(c.sessionStorage, null, 2))));
  }
  return $(
    l.join(`
`),
    e.maxChars
  );
}
function Te(e, t = 40) {
  if (typeof e != "string") return "";
  let r = e.replace(/\s+/g, " ").trim();
  return r.length <= t ? r : `${r.slice(0, t)}\u2026`;
}
function yn(e) {
  if (!e) return "";
  if ("targetComponent" in e || "rootComponent" in e) {
    let r = e,
      n = r.targetComponent ?? r.parentChain?.[0] ?? r.rootComponent;
    return n?.componentName ? ` [${n.componentName}]` : "";
  }
  let t = e;
  return t.componentName ? ` [${t.componentName}]` : "";
}
function Re(e, t = 40) {
  if (!e) return "<unknown>";
  let r = (e.tagName || "element").toLowerCase(),
    n = e.id ? `#${e.id}` : "",
    s = Array.isArray(e.classNames)
      ? e.classNames.filter(Boolean).slice(0, 3)
      : [],
    a = s.length > 0 ? `.${s.join(".")}` : "",
    i = Te(e.text ?? e.accessibleName, t),
    l = i ? ` "${i}"` : "",
    o = yn(e.framework);
  return `<${r}${n}${a}${l}>${o}`;
}
function X(e, t, r) {
  let n = e.element ?? e.target,
    s = C(r ?? e.elapsedMs),
    a = e.kind ?? "event",
    i = Re(n),
    l = e.input?.data ?? e.input?.value ?? n?.value ?? n?.attributes?.value,
    o =
      e.input?.key ??
      (typeof e.metadata?.shortcut == "string"
        ? e.metadata.shortcut
        : void 0) ??
      (typeof e.metadata?.key == "string" ? e.metadata.key : void 0),
    u = typeof e.metadata?.toUrl == "string" ? e.metadata.toUrl : void 0,
    c = [];
  (l !== void 0 && l !== "" && c.push(`val="${Te(String(l), 50)}"`),
    o && c.push(`key=${o}`),
    u && c.push(`to=${Te(u, 80)}`),
    e.screenshot?.dataUrl && c.push(`img=${e.screenshot.dataUrl}`));
  let f = c.length > 0 ? ` ${c.join(" ")}` : "";
  return `[${t}] ${s} [${a}] ${i}${f}`;
}
import { mkdirSync as vn, writeFileSync as xn } from "node:fs";
import { dirname as wn, join as Sn, resolve as $n } from "node:path";
var kn = Math.floor(1.5 * 1024 * 1024);
function Cn(e) {
  let t = e.toLowerCase();
  return t.endsWith(".png")
    ? "image/png"
    : t.endsWith(".webp")
      ? "image/webp"
      : t.endsWith(".gif")
        ? "image/gif"
        : "image/jpeg";
}
function ue(e, t) {
  let r = e.getBinaryFile(t);
  if (!r) return;
  let { sanitized: n } = Ie(t),
    s =
      e.kind === "session"
        ? e.sessionId.slice(0, 8) || "session"
        : "screenshot",
    a = $n(Sn(le(), "images", s, n));
  try {
    return (vn(wn(a), { recursive: !0 }), xn(a, r), a);
  } catch {
    return;
  }
}
function z(e, t, r) {
  let n = e.getBinaryFile(t);
  if (!n) return [{ type: "text", text: `[Image not found in pack: ${t}]` }];
  let s = Cn(t),
    a = (n.byteLength / 1024).toFixed(1),
    i = ue(e, t);
  if (n.byteLength > kn)
    return [
      {
        type: "text",
        text: i
          ? `[Image "${t}" (${a} KB) saved to: ${i} \u2014 call read_file on this path to view it directly]`
          : `[Image "${t}" (${a} KB) exceeds inline size limit (1.5 MB). Call extract_pack to write files to disk and read the image from the extracted path.]`,
      },
    ];
  let l = Buffer.from(n).toString("base64"),
    o = [],
    u = i ? ` -> Saved to: ${i}` : "";
  return (
    r &&
      o.push({
        type: "text",
        text: `${r} (${t}, ${a} KB, ${s})${u} (Tip: call read_file on the saved image path to view the visual image directly \u2014 do NOT unzip or run scripts)`,
      }),
    o.push({ type: "image", data: l, mimeType: s }),
    o
  );
}
function dt(e) {
  let t = M(e.pack);
  if (t.kind !== "session")
    throw new Error(
      `UNSUPPORTED_PACK_KIND: get_interactions requires a session evidence pack, but "${e.pack}" is a screenshot pack.`
    );
  let r = t.getInteractions(),
    n =
      e.kinds && e.kinds.length > 0
        ? new Set(e.kinds.map((u) => u.toLowerCase()))
        : void 0,
    s = r
      .map((u, c) => ({
        index: c,
        relativeMs: t.toRelativeMs(u.createdAt) ?? u.elapsedMs,
        item: u,
      }))
      .filter(
        ({ index: u, item: c }) =>
          !(
            (e.fromIndex !== void 0 && u < e.fromIndex) ||
            (n && !n.has((c.kind ?? "").toLowerCase()))
          )
      ),
    a = Math.max(1, e.limit ?? 60),
    i = s.slice(0, a),
    l;
  if (e.format === "json")
    l = $(
      JSON.stringify(
        { totalInteractions: r.length, matchedCount: s.length, items: i },
        null,
        2
      ),
      e.maxChars
    );
  else {
    let u = [];
    if (
      (u.push(
        `# Recorded Interactions (showing ${i.length} of ${s.length} matched, total=${r.length})`
      ),
      i.length === 0)
    )
      u.push("(No interactions matched)");
    else
      for (let { index: c, relativeMs: f, item: h } of i)
        u.push(`- ${X(h, c, f)}`);
    if (s.length > i.length) {
      let c = (i[i.length - 1]?.index ?? 0) + 1;
      u.push(`
\u2026 ${s.length - i.length} more interactions available. Pass fromIndex=${c} to continue.`);
    }
    l = $(
      u.join(`
`),
      e.maxChars
    );
  }
  let o = [{ type: "text", text: l }];
  if (e.includeScreenshot)
    for (let { index: u, item: c } of i.slice(0, 3)) {
      let f =
        c.screenshot?.dataUrl && !c.screenshot.dataUrl.startsWith("data:")
          ? c.screenshot.dataUrl
          : void 0;
      f && o.push(...z(t, f, `Interaction [${u}] screenshot`));
    }
  return o;
}
function bn(e, t) {
  if (!t || t === "all") return !0;
  let r = e.status ?? 0,
    n = r === 0 || r >= 400 || !!e.errorText;
  return t === "failed"
    ? n
    : t === "4xx"
      ? r >= 400 && r < 500
      : t === "5xx"
        ? r >= 500 && r < 600
        : t === "2xx"
          ? r >= 200 && r < 300
          : t === "3xx"
            ? r >= 300 && r < 400
            : Array.isArray(t)
              ? t.includes(r)
              : !0;
}
function fe(e, t = {}) {
  let r = e.getNetworkEntries(),
    n = t.urlContains?.toLowerCase(),
    s = t.method?.toUpperCase(),
    a = t.type?.toLowerCase(),
    i = [];
  for (let u of r) {
    if (
      !bn(u, t.status) ||
      (n && !u.url.toLowerCase().includes(n)) ||
      (s && (u.method ?? "GET").toUpperCase() !== s) ||
      (a && (u.type ?? "").toLowerCase() !== a)
    )
      continue;
    let c = u.status ?? 0,
      f = c === 0 || c >= 400 || !!u.errorText,
      h =
        !!u.response?.bodyPath ||
        typeof u.response?.body == "string" ||
        u.response?.bodyStatus === "captured";
    i.push({
      id: u.id,
      relativeMs: e.toRelativeMs(u.createdAt),
      method: u.method ?? "GET",
      status: c,
      durationMs: u.durationMs,
      type: u.type,
      url: u.url,
      mimeType: u.response?.mimeType,
      bodyStatus: u.response?.bodyStatus,
      byteLength: u.response?.byteLength,
      hasBody: h,
      isFailure: f,
    });
  }
  t.status ||
    i.sort((u, c) =>
      u.isFailure !== c.isFailure
        ? u.isFailure
          ? -1
          : 1
        : (u.relativeMs ?? 0) - (c.relativeMs ?? 0)
    );
  let l = Math.max(0, t.offset ?? 0),
    o = Math.max(1, t.limit ?? 50);
  return {
    totalEntries: r.length,
    matchedCount: i.length,
    offset: l,
    limit: o,
    items: i.slice(l, l + o),
  };
}
function he(e) {
  let t = C(e.relativeMs),
    r = U(e.durationMs),
    n = e.isFailure ? "!" : "",
    s = e.hasBody
      ? `[body:${e.byteLength ?? "?"}B]`
      : `[${e.bodyStatus ?? "no-body"}]`;
  return `${e.id} | ${t} | ${e.method} ${n}${e.status} (${r}) | ${e.type ?? "?"} | ${s} | ${e.url}`;
}
function pt(e, t, r = {}) {
  let n = e.getNetworkEntries(),
    s =
      n.find((f) => f.id === t) ??
      n.find((f) => f.id.endsWith(t) || f.url.includes(t));
  if (!s)
    throw new Error(
      `REQUEST_NOT_FOUND: No network entry found matching "${t}". Call query_network first to list available entry IDs.`
    );
  let a = new Set(
      r.include && r.include.length > 0
        ? r.include
        : ["summary", "headers", "initiator", "body"]
    ),
    i = e.getNetworkDetails(),
    l = a.has("headers") || a.has("initiator") ? i[s.id] : void 0,
    o,
    u,
    c = !1;
  if (a.has("body") || r.jsonPath) {
    let f = e.getNetworkBody(s);
    if (f !== void 0)
      if (r.jsonPath)
        try {
          let h = JSON.parse(f);
          u = J(h, r.jsonPath);
        } catch (h) {
          let m = h instanceof Error ? h.message : String(h);
          throw new Error(
            `INVALID_RESPONSE_JSON: Cannot evaluate jsonPath "${r.jsonPath}" because response body is not valid JSON (${m})`
          );
        }
      else {
        let h = r.bodyMaxChars ?? 8e3;
        f.length > h ? ((o = f.slice(0, h)), (c = !0)) : (o = f);
      }
  }
  return {
    entry: s,
    relativeMs: e.toRelativeMs(s.createdAt),
    details: l,
    bodyText: o,
    extractedJson: u,
    bodyTruncated: c,
  };
}
function mt(e) {
  let t = M(e.pack);
  if (t.kind !== "session")
    throw new Error(
      `UNSUPPORTED_PACK_KIND: get_request requires a session evidence pack, but "${e.pack}" is a screenshot pack.`
    );
  let r = pt(t, e.id, {
    include: e.include,
    jsonPath: e.jsonPath,
    bodyMaxChars: e.bodyMaxChars,
  });
  if (e.format === "json") return $(JSON.stringify(r, null, 2), e.maxChars);
  let { entry: n, details: s } = r,
    a = new Set(
      e.include && e.include.length > 0
        ? e.include
        : ["summary", "headers", "initiator", "body"]
    ),
    i = [];
  if (
    (a.has("summary") &&
      (i.push(`# Request \`${n.id}\` (${n.method ?? "GET"} ${n.status ?? 0})`),
      i.push(`- **URL**: ${n.url}`),
      i.push(
        `- **Time**: ${C(r.relativeMs)} | Duration: ${U(n.durationMs)} | Type: ${n.type ?? "\u2014"}`
      ),
      i.push(
        `- **Response Info**: mimeType=${n.response?.mimeType ?? "\u2014"}, bodyStatus=${n.response?.bodyStatus ?? "\u2014"}, byteLength=${n.response?.byteLength ?? "\u2014"}, bodyPath=${n.response?.bodyPath ?? "inline/none"}`
      ),
      n.errorText && i.push(`- **Error**: ${n.errorText}`)),
    a.has("headers"))
  ) {
    let l = s?.requestHeaders ?? n.request?.headers,
      o = s?.responseHeaders ?? n.response?.headers;
    (l &&
      Object.keys(l).length > 0 &&
      (i.push(`
## Request Headers`),
      i.push(JSON.stringify(l, null, 2))),
      o &&
        Object.keys(o).length > 0 &&
        (i.push(`
## Response Headers`),
        i.push(JSON.stringify(o, null, 2))));
    let u =
      s?.requestBody ?? s?.postData ?? n.request?.postData ?? n.request?.body;
    u &&
      (i.push(`
## Request Body`),
      i.push(u.slice(0, 4e3)));
  }
  return (
    a.has("initiator") &&
      s?.initiator &&
      (i.push(`
## Initiator`),
      i.push(JSON.stringify(s.initiator, null, 2).slice(0, 3e3))),
    e.jsonPath !== void 0
      ? (i.push(`
## Extracted Response Body (jsonPath: \`${e.jsonPath}\`)`),
        i.push(JSON.stringify(r.extractedJson, null, 2)))
      : a.has("body") &&
        (i.push(`
## Response Body`),
        r.bodyText === void 0
          ? i.push("(No response body captured for this entry)")
          : (i.push(r.bodyText),
            r.bodyTruncated &&
              i.push(`
\u2026 [Response body truncated at ${e.bodyMaxChars ?? 8e3} chars. Pass \`jsonPath\` (e.g. "data.definition.form.elements[id=ssd_a]") or a higher \`bodyMaxChars\` to inspect further.]`))),
    $(
      i.join(`
`),
      e.maxChars
    )
  );
}
var Oe =
  /^(?:word-break|overflow-wrap|word-wrap|white-space|white-space-collapse|text-wrap|text-wrap-mode|text-overflow|overflow|overflow-x|overflow-y|display|width|max-width|min-width|height|max-height|min-height|flex|flex-grow|flex-shrink|flex-basis|flex-wrap|flex-direction|-webkit-line-clamp|line-clamp|position|z-index)$/i;
function de(e) {
  if (!e) return [];
  let t = new Map(),
    r = (a) => {
      if (!a) return;
      let i = {};
      for (let [l, o] of Object.entries(a))
        Oe.test(l) &&
          o !== void 0 &&
          o !== "" &&
          o !== "normal" &&
          o !== "auto" &&
          o !== "none" &&
          o !== "visible" &&
          o !== "static" &&
          (i[l] = o);
      return Object.keys(i).length > 0 ? i : void 0;
    },
    n = (a, i) => {
      let l = a.selector || a.tagName || "element",
        o = a.selectorPath,
        u = a.componentName,
        c = a.componentFile,
        f = a.componentLine,
        h = u ? `${u}${c ? ` @ ${c}${f ? `:${f}` : ""}` : ""}` : void 0,
        m = a.layoutContext ?? {},
        d = m.textOverflow ?? a.textOverflow,
        p = m.flexSqueezeRisk ?? a.flexSqueezeRisk,
        g = m.gridSelf ?? a.gridSelf,
        y = a.computedStyles,
        v =
          typeof a.innerText == "string"
            ? a.innerText.replace(/\s+/g, " ").trim().slice(0, 80)
            : void 0;
      if (d && d.isTruncated) {
        let x = d.scrollDimension ?? {},
          w = d.clientDimension ?? {},
          S = d.overflowDelta ?? {},
          b = String(d.truncationType ?? "truncated"),
          I = `text_overflow|${l}|${b}|${w.width ?? 0}x${w.height ?? 0}`,
          P = t.get(I);
        P
          ? i !== void 0 &&
            !P.anchorIndices.includes(i) &&
            P.anchorIndices.push(i)
          : t.set(I, {
              kind: "text_overflow",
              selector: l,
              selectorPath: o,
              component: h,
              anchorIndices: i !== void 0 ? [i] : [],
              summary: `${b} truncation (scroll ${x.width ?? "?"}x${x.height ?? "?"}px > client ${w.width ?? "?"}x${w.height ?? "?"}px, delta +${S.width ?? 0}px W / +${S.height ?? 0}px H)`,
              sampleText: v,
              keyStyles: r(y),
            });
      }
      if (p && p.isSqueezed) {
        let x = `flex_squeeze|${l}|${p.renderedWidth ?? 0}`,
          w = t.get(x);
        w
          ? i !== void 0 &&
            !w.anchorIndices.includes(i) &&
            w.anchorIndices.push(i)
          : t.set(x, {
              kind: "flex_squeeze",
              selector: l,
              selectorPath: o,
              component: h,
              anchorIndices: i !== void 0 ? [i] : [],
              summary: `Flex squeeze (intrinsic ${p.intrinsicWidth ?? "?"}px -> rendered ${p.renderedWidth ?? "?"}px, flex-shrink=${p.flexShrink ?? "?"})`,
              sampleText: v,
              keyStyles: r(y),
            });
      }
      if (g && g.isGridOverflow) {
        let x = `grid_overflow|${l}`,
          w = t.get(x);
        w
          ? i !== void 0 &&
            !w.anchorIndices.includes(i) &&
            w.anchorIndices.push(i)
          : t.set(x, {
              kind: "grid_overflow",
              selector: l,
              selectorPath: o,
              component: h,
              anchorIndices: i !== void 0 ? [i] : [],
              summary: String(g.reason ?? "Grid item overflowed track"),
              sampleText: v,
              keyStyles: r(y),
            });
      }
    };
  (e.anchors ?? []).forEach((a, i) => {
    n(a, i);
  });
  let s = (a) => {
    if (!a) return;
    n(a);
    let i = a.children;
    if (Array.isArray(i)) for (let l of i) s(l);
  };
  return (e.tree && s(e.tree), Array.from(t.values()));
}
function Mn(e, t) {
  let r = t.get(e);
  if (!r) return e;
  if (r.href)
    try {
      let n = new URL(r.href),
        s = n.pathname.split("/").filter(Boolean).pop() ?? n.pathname;
      return `${e}:${s}`;
    } catch {
      let n = r.href.split("?")[0],
        s = n.split("/").filter(Boolean).pop() ?? n.slice(-30);
      return `${e}:${s}`;
    }
  return `${e}:inline`;
}
function En(e) {
  let t = [];
  if (e.styleProps && Object.keys(e.styleProps).length > 0)
    for (let [r, n] of Object.entries(e.styleProps))
      Oe.test(r) && t.push(`${r}: ${n}`);
  else if (e.cssText) {
    let r = e.cssText.match(/\{([\s\S]*)\}/),
      n = r ? r[1] : e.cssText;
    for (let s of n.split(";")) {
      let a = s.trim();
      if (!a) continue;
      let i = a.indexOf(":");
      if (i > 0) {
        let l = a.slice(0, i).trim();
        Oe.test(l) && t.push(a);
      }
    }
  }
  return t;
}
function gt(e) {
  if (!e) return [];
  let t = e.sheets ?? [],
    r = e.rules ?? [],
    n = e.elements ?? [],
    s = new Map();
  for (let c of t) s.set(c.id, c);
  let a = new Map();
  for (let c of r) a.set(c.id, c);
  let i = [];
  i.push(`
## CSS Cascade Index (${t.length} stylesheets, ${r.length} rules, ${n.length} indexed elements)`);
  let l = new Set();
  for (let c of n)
    for (let f of c.matchedRuleIds ?? []) {
      let h = a.get(f);
      h && l.add(h.sheetId);
    }
  let o = t.filter((c) => !!c.href && (l.size === 0 || l.has(c.id))),
    u = t.filter((c) => !c.href).length;
  if (o.length > 0 || u > 0) {
    i.push("### Active Stylesheets (referenced by captured elements)");
    for (let c of o.slice(0, 12))
      i.push(`- \`${c.id}\`: ${c.href} (${c.rulesCount ?? 0} rules)`);
    (o.length > 12 && i.push(`- ... +${o.length - 12} more active stylesheets`),
      u > 0 && i.push(`- \`inline <style>\`: ${u} inline style tag(s)`));
  }
  if (n.length > 0) {
    i.push("### Indexed Elements & Key Layout/Wrapping Rule Overrides");
    let c = new Map(),
      f = [];
    n.forEach((h, m) => {
      let d = `${h.tagName}|${(h.matchedRuleIds ?? []).join(",")}`,
        p = c.get(d);
      p ? p.push(h.id) : (c.set(d, [h.id]), f.push({ idx: m, el: h, sig: d }));
    });
    for (let { idx: h, el: m, sig: d } of f.slice(0, 12)) {
      let p = m.matchedRuleIds ?? [],
        g = c.get(d) ?? [m.id],
        y = g.length > 1 ? ` (also ${g.slice(1).join(", ")})` : "",
        v = new Map();
      for (let x of p) {
        let w = a.get(x);
        if (!w) continue;
        let S = En(w);
        if (S.length === 0) continue;
        let b = `${w.selectorText}||${S.join(";")}`,
          I = Mn(w.sheetId, s),
          P = v.get(b);
        P
          ? (P.ruleIds.push(x), P.sheetRefs.add(I))
          : v.set(b, {
              rule: w,
              decls: S,
              ruleIds: [x],
              sheetRefs: new Set([I]),
            });
      }
      i.push(
        `- **[${h}] \`${m.id}\`${y} \`<${m.tagName}>\` \`${m.selector}\`** (${p.length} matched rules)`
      );
      for (let x of v.values()) {
        let w =
            x.ruleIds.length > 1
              ? `${x.ruleIds[0]} (+${x.ruleIds.length - 1})`
              : x.ruleIds[0],
          S = Array.from(x.sheetRefs).slice(0, 2).join(", ");
        i.push(
          `  - [${w} @ ${S}] \`${x.rule.selectorText}\` -> \`${x.decls.join("; ")}\``
        );
      }
    }
    f.length > 12 &&
      i.push(
        `- ... +${f.length - 12} more elements (call \`get_scene(selector="...")\` or \`search_pack\` to inspect)`
      );
  }
  return i;
}
function yt(e, t, r) {
  let n = [],
    s = r.selector?.trim().toLowerCase(),
    a = r.cssProperty?.trim().toLowerCase(),
    i = a ? new RegExp(a, "i") : void 0,
    l = e?.anchors ?? [],
    o = [];
  (l.forEach((f, h) => {
    if (!s) {
      o.push({ idx: h, anchor: f });
      return;
    }
    `${h} ${f.selector ?? ""} ${f.selectorPath ?? ""} ${f.tagName ?? ""} ${f.componentName ?? ""} ${f.componentFile ?? ""} ${f.innerText ?? ""}`
      .toLowerCase()
      .includes(s) && o.push({ idx: h, anchor: f });
  }),
    n.push(`## Matched DOM Anchors (${o.length} of ${l.length})`));
  let u = new Map(),
    c = [];
  for (let f of o) {
    let h = f.anchor,
      m = h.layoutContext?.textOverflow?.truncationType,
      d = `${h.selectorPath ?? h.selector}|${h.componentName ?? ""}|${m ?? ""}|${JSON.stringify(h.intentFlags ?? {})}`,
      p = u.get(d);
    p
      ? (p.push(f.idx),
        s && o.length <= 10 && c.push({ ...f, sig: `${d}#${f.idx}` }))
      : (u.set(d, [f.idx]), c.push({ ...f, sig: d }));
  }
  for (let { idx: f, anchor: h, sig: m } of c.slice(0, 30)) {
    let d = u.get(m) ?? [f],
      p =
        d.length > 1
          ? ` (and ${d.length - 1} identical sibling anchor(s): [${d.slice(1, 8).join(", ")}${d.length > 8 ? ", ..." : ""}])`
          : "",
      g = h.componentName
        ? ` [${h.componentName}${h.componentFile ? ` @ ${h.componentFile}:${h.componentLine ?? ""}` : ""}]`
        : "";
    if (
      (n.push(
        `- **[${f}] \`${h.selectorPath ?? h.selector ?? "?"}\`**${g}${p}`
      ),
      h.intentFlags &&
        Object.keys(h.intentFlags).length > 0 &&
        n.push(`  - flags: ${JSON.stringify(h.intentFlags)}`),
      h.innerText &&
        n.push(
          `  - text: "${h.innerText.replace(/\s+/g, " ").trim().slice(0, 140)}"`
        ),
      h.relativeRect && n.push(`  - rect: ${JSON.stringify(h.relativeRect)}`),
      h.boxModel && n.push(`  - boxModel: ${JSON.stringify(h.boxModel)}`),
      h.computedStyles && Object.keys(h.computedStyles).length > 0)
    ) {
      let y = i
        ? Object.fromEntries(
            Object.entries(h.computedStyles).filter(
              ([v, x]) => i.test(v) || i.test(x)
            )
          )
        : h.computedStyles;
      n.push(`  - computedStyles: ${JSON.stringify(y)}`);
    }
    h.layoutContext &&
      Object.keys(h.layoutContext).length > 0 &&
      n.push(`  - layoutContext: ${JSON.stringify(h.layoutContext)}`);
  }
  if (t) {
    let f = t.sheets ?? [],
      h = t.rules ?? [],
      m = t.elements ?? [],
      d = new Map();
    for (let y of f) d.set(y.id, y);
    let p = new Map();
    for (let y of h) p.set(y.id, y);
    let g = [];
    (m.forEach((y, v) => {
      if (!s) {
        g.push({ idx: v, el: y });
        return;
      }
      `${v} ${y.id} ${y.tagName} ${y.selector}`.toLowerCase().includes(s) &&
        g.push({ idx: v, el: y });
    }),
      n.push(`
## Matched CSS Cascade Elements (${g.length} of ${m.length})`));
    for (let { idx: y, el: v } of g.slice(0, 20)) {
      n.push(`- **[${y}] \`${v.id}\` \`<${v.tagName}>\` \`${v.selector}\`**`);
      let x = new Map();
      for (let w of v.matchedRuleIds ?? []) {
        let S = p.get(w);
        if (!S || (i && !i.test(S.cssText) && !i.test(S.selectorText)))
          continue;
        let b = `${S.selectorText}||${S.cssText}`,
          I = d.get(S.sheetId),
          P = I?.href
            ? `${S.sheetId} (${I.href})`
            : `${S.sheetId} (inline <${I?.ownerNodeTag ?? "style"}>)`,
          L = x.get(b);
        L
          ? (L.ruleIds.push(w), L.sheetHrefs.add(P))
          : x.set(b, { rule: S, ruleIds: [w], sheetHrefs: new Set([P]) });
      }
      if (x.size === 0) n.push("  - (no matched rules for filter)");
      else
        for (let w of x.values()) {
          let S = w.ruleIds.join(", "),
            b = Array.from(w.sheetHrefs).join(" | ");
          n.push(
            `  - **[${S}]** [sheet: ${b}] \`${w.rule.selectorText}\` -> \`${w.rule.cssText}\``
          );
        }
      if (v.inheritedRules && v.inheritedRules.length > 0)
        for (let w of v.inheritedRules) {
          let S = JSON.stringify(w.inheritedProps ?? {});
          if (i && !i.test(S) && !i.test(w.ancestorSelector)) continue;
          let b = p.get(w.ruleId),
            P = (b ? d.get(b.sheetId) : void 0)?.href ?? b?.sheetId ?? "?";
          n.push(
            `  - *[inherited from \`<${w.ancestorTagName}> ${w.ancestorSelector}\` via ${w.ruleId} @ ${P}]*: ${S}`
          );
        }
    }
  }
  return n;
}
function vt(e) {
  let t = M(e.pack),
    r = e.sceneId ?? (e.sceneIndex !== void 0 ? String(e.sceneIndex) : void 0);
  if (t.kind === "screenshot") {
    let d = t.domContext?.anchors ?? [],
      p = d.map((S) => S.intentFlags?.textComment).filter(Boolean),
      g = de(t.domContext),
      y = e.selector ?? r,
      x = [
        {
          type: "text",
          text:
            e.format === "json"
              ? $(
                  JSON.stringify(
                    {
                      kind: "screenshot",
                      smallestCommonAncestorSelector:
                        t.domContext?.smallestCommonAncestorSelector,
                      textComments: p,
                      deviations: g,
                      anchors: y
                        ? d.filter((S, b) =>
                            `${b} ${S.selector ?? ""} ${S.selectorPath ?? ""} ${S.componentName ?? ""} ${S.innerText ?? ""}`
                              .toLowerCase()
                              .includes(y.toLowerCase())
                          )
                        : d,
                      screenshotPath: t.getScreenshotImagePath(),
                    },
                    null,
                    2
                  ),
                  e.maxChars
                )
              : $(
                  [
                    "# Screenshot Scene, DOM Anchors & CSS Cascade",
                    `- **Text Annotations**: ${p.length > 0 ? p.join(" | ") : "(none \u2014 expectation must be treated as inferred hypothesis)"}`,
                    `- **Smallest Common Ancestor**: \`${t.domContext?.smallestCommonAncestorSelector ?? "\u2014"}\``,
                    ...(g.length > 0
                      ? [
                          `
## Auto-Detected Layout/Overflow Deviations (${g.length})`,
                          ...g.map(
                            (S) =>
                              `- \u26A0\uFE0F **[${S.kind}] \`${S.selectorPath ?? S.selector}\`** (anchors: [${S.anchorIndices.slice(0, 6).join(",")}]) \u2014 ${S.summary}${S.keyStyles ? ` | styles=${JSON.stringify(S.keyStyles)}` : ""}`
                          ),
                        ]
                      : []),
                    "",
                    ...yt(t.domContext, t.cascade, {
                      selector: y,
                      cssProperty: e.cssProperty,
                    }),
                  ].join(`
`),
                  e.maxChars
                ),
        },
      ],
      w = t.getScreenshotImagePath();
    return (
      (e.includeImage ?? !0) &&
        w &&
        x.push(...z(t, w, "Screenshot pack image")),
      x
    );
  }
  let n = t.getIssueScenes();
  if (n.length === 0)
    return [
      {
        type: "text",
        text: "No issueScenes were recorded in this evidence pack.",
      },
    ];
  let s = r ? n.find((d) => d.id === r || String(d.index) === r) : n[0];
  if (!s) {
    let d = n.map((p) => `${p.index}:${p.id}`).join(", ");
    throw new Error(
      `SCENE_NOT_FOUND: Scene "${r ?? e.sceneId}" not found. Available scenes: [${d}]`
    );
  }
  let { scene: a } = s,
    i = a.narrative?.expected,
    l = typeof i == "string" ? i : i?.text,
    o =
      typeof i == "object" && i !== null
        ? (i.confidence ?? "missing")
        : l
          ? "explicit"
          : "missing",
    u =
      a.targets && a.targets.length > 0
        ? a.targets
        : a.target
          ? [a.target]
          : [],
    c;
  if (e.format === "json")
    c = $(
      JSON.stringify(
        {
          id: s.id,
          index: s.index,
          relativeMs: t.toRelativeMs(
            a.selectionStartedAtEpochMs ?? a.observedAtEpochMs
          ),
          narrative: {
            actual: a.narrative?.actual ?? null,
            expected: l ?? null,
            confidence: o,
            confidenceNotice:
              o === "missing"
                ? "UNCAPTURED_EXPECTATION: User expectation was not captured. Any expectation you formulate MUST be explicitly declared as an inferred hypothesis."
                : void 0,
          },
          sequenceContextNotice:
            "RAW_SAME_TIME_CONTEXT_ONLY: sequenceContext lists events near the mark moment and MUST NOT be treated as a proven causal chain.",
          sequenceContext: a.sequenceContext,
          targets: u,
          annotation: a.annotation,
          originalSource: s.originalSource,
          annotatedSource: s.annotatedSource,
        },
        null,
        2
      ),
      e.maxChars
    );
  else {
    let d = [],
      p = t.toRelativeMs(a.selectionStartedAtEpochMs ?? a.observedAtEpochMs);
    (d.push(`# Issue Scene [${s.index}] \`${s.id}\` (at ${C(p)})`),
      d.push(`
## 1. Narrative & Expectation Anchor`),
      d.push(`- **actual**: ${a.narrative?.actual || "(empty)"}`),
      d.push(`- **expected** [confidence: \`${o}\`]: ${l || "(missing)"}`),
      (o === "missing" || !l) &&
        d.push(
          "  > \u26A0\uFE0F **UNCAPTURED EXPECTATION**: You MUST explicitly state that the expected behavior was not captured and mark any inferred expectation as a hypothesis."
        ),
      d.push(`
## 2. Selected DOM Targets (${u.length})`));
    for (let [y, v] of u.entries()) {
      let x = Re(v.element, 80),
        w = (v.ancestors ?? [])
          .slice(0, 6)
          .map((S) => {
            let b = S.id ? `#${S.id}` : "",
              I =
                S.classNames && S.classNames.length > 0
                  ? `.${S.classNames.slice(0, 2).join(".")}`
                  : "";
            return `${S.tagName ?? "div"}${b}${I}`;
          })
          .join(" <- ");
      (d.push(`- **Target #${y}**: ${x}`),
        w && d.push(`  - **Ancestors**: ${w}`),
        v.sanitizedHtml &&
          d.push(`  - **sanitizedHtml**: \`${v.sanitizedHtml.slice(0, 600)}\``),
        v.computedStyle &&
          Object.keys(v.computedStyle).length > 0 &&
          d.push(`  - **computedStyle**: ${JSON.stringify(v.computedStyle)}`),
        v.state &&
          Object.keys(v.state).length > 0 &&
          d.push(`  - **state**: ${JSON.stringify(v.state)}`));
    }
    let g = a.sequenceContext;
    if (
      (d.push(`
## 3. Sequence Context (Raw Same-Time Context \u2014 NOT Proven Causality)`),
      !g)
    )
      d.push("(No sequenceContext recorded)");
    else {
      let y = g.interactions ?? [],
        v = g.consoleErrors ?? [],
        x = g.networkFailures ?? [];
      d.push(
        `Window: ${g.windowMs ?? 6e4}ms before anchor | ${y.length} interactions, ${v.length} console errors, ${x.length} network failures`
      );
      for (let w of y.slice(-15))
        d.push(
          `  - [${w.offsetMs ?? 0}ms] [${w.kind}] <${w.tagName ?? "?"}> text="${w.text ?? ""}" ${w.value !== void 0 ? `val="${w.value}"` : ""}`
        );
      for (let w of v)
        d.push(
          `  - [${w.offsetMs ?? 0}ms] [CONSOLE ${w.level ?? "ERROR"}] ${w.text ?? ""}`
        );
      for (let w of x)
        d.push(
          `  - [${w.offsetMs ?? 0}ms] [NET ${w.method ?? "GET"} ${w.status ?? "ERR"}] ${w.url ?? ""}`
        );
    }
    c = $(
      d.join(`
`),
      e.maxChars
    );
  }
  let f = [{ type: "text", text: c }],
    h = e.includeImage ?? !0,
    m = s.annotatedSource ?? s.originalSource;
  return (h && m && f.push(...z(t, m, `Scene [${s.index}] screenshot`)), f);
}
function xt(e) {
  let t = M(e.pack);
  if (t.kind === "screenshot") {
    let i = t.getScreenshotImagePath();
    if (!i)
      throw new Error(
        `SCREENSHOT_NOT_FOUND: No screenshot image found in screenshot pack "${e.pack}".`
      );
    return z(t, i, "Screenshot pack image");
  }
  let r = e.kind ?? (e.step !== void 0 ? "step" : "issue-annotated");
  if (r === "step") {
    let i = e.step ?? 1;
    for (let o of ["jpg", "png", "jpeg", "webp"]) {
      let u = `screenshots/step-${i}.${o}`;
      if (t.files.has(u)) {
        let c = t.data.screenshotSummaries?.find((h) => h.step === i),
          f = c
            ? `Step ${i} screenshot (+${c.elapsedMs ?? 0}ms [${c.kind ?? "?"}] ${c.element ?? ""})`
            : `Step ${i} screenshot`;
        return z(t, u, f);
      }
    }
    let l = Array.from(t.files.keys())
      .filter((o) => o.startsWith("screenshots/step-"))
      .slice(0, 15)
      .join(", ");
    throw new Error(
      `STEP_SCREENSHOT_NOT_FOUND: Screenshot for step ${i} not found. Available sample: [${l}]`
    );
  }
  let n = t.getIssueScenes();
  if (n.length === 0)
    throw new Error(
      'SCENE_SCREENSHOT_NOT_FOUND: Pack has no issueScenes. Use kind="step" with step=1..N to inspect interaction screenshots.'
    );
  let s = e.sceneId
    ? n.find((i) => i.id === e.sceneId || String(i.index) === e.sceneId)
    : n[0];
  if (!s)
    throw new Error(`SCENE_NOT_FOUND: Scene "${e.sceneId}" not found in pack.`);
  let a =
    r === "issue-original"
      ? (s.originalSource ?? s.annotatedSource)
      : (s.annotatedSource ?? s.originalSource);
  if (!a)
    throw new Error(
      `SCENE_IMAGE_MISSING: Scene "${s.id}" does not have a ${r} image file.`
    );
  return z(t, a, `Scene [${s.index}] (${s.id}) ${r}`);
}
function Nn(e, t) {
  return typeof e == "string" && e.trim()
    ? e
    : Array.isArray(e) && e.length > 0
      ? e.map((r) => {
          let n = r.functionName || "<anonymous>",
            s = r.sourceMappedLocation,
            a =
              s?.resolved && s.originalFile
                ? `${s.originalFile}:${s.originalLine ?? 0}`
                : `${r.url ?? "?"}:${r.lineNumber ?? 0}`;
          return `at ${n} (${a})`;
        }).join(`
`)
      : t;
}
function pe(e, t = {}) {
  let r = e.getConsoleEntries(),
    n =
      t.levels && t.levels.length > 0
        ? new Set(
            t.levels.flatMap((u) => {
              let c = u.toLowerCase();
              return c === "warn" || c === "warning"
                ? ["warn", "warning"]
                : [c];
            })
          )
        : void 0,
    s = t.search?.toLowerCase(),
    a = t.regex ? new RegExp(t.regex, "i") : void 0,
    i = [];
  r.forEach((u, c) => {
    let f = (u.level ?? "log").toLowerCase();
    if (n && !n.has(f)) return;
    let h = e.toRelativeMs(u.createdAt);
    if (
      (t.fromMs !== void 0 && h !== void 0 && h < t.fromMs) ||
      (t.toMs !== void 0 && h !== void 0 && h > t.toMs)
    )
      return;
    let m = u.text ?? "",
      d = u.url ?? u.source ?? "",
      p = Nn(u.stackTrace, u.stack),
      g = `${m}
${d}
${p ?? ""}`;
    if ((s && !g.toLowerCase().includes(s)) || (a && !a.test(g))) return;
    let y = d
        ? `${d}${u.lineNumber !== void 0 ? `:${u.lineNumber}` : ""}`
        : void 0,
      v = u.sourceMappedLocation,
      x = v?.originalFunctionName ?? v?.originalName,
      w =
        v?.resolved && v.originalFile
          ? `${v.originalFile}:${v.originalLine ?? 0}${v.originalColumn !== void 0 ? `:${v.originalColumn}` : ""}${x ? ` (${x})` : ""}`
          : void 0;
    i.push({
      index: c,
      id: u.id,
      relativeMs: h,
      level: f,
      text: m,
      location: y,
      sourceMapped: w,
      stack: p,
    });
  });
  let l = Math.max(0, t.offset ?? 0),
    o = Math.max(1, t.limit ?? 50);
  return {
    totalEntries: r.length,
    matchedCount: i.length,
    offset: l,
    limit: o,
    items: i.slice(l, l + o),
  };
}
function me(e) {
  let t = C(e.relativeMs),
    r = e.sourceMapped
      ? ` (${e.location ?? "?"} -> ${e.sourceMapped})`
      : e.location
        ? ` (${e.location})`
        : "",
    n = `[#${e.index}] ${t} [${e.level.toUpperCase()}] ${e.text}${r}`;
  if (e.stack) {
    let s = e.stack
      .split(
        `
`
      )
      .slice(0, 5)
      .map((a) => `    ${a.trim()}`).join(`
`);
    n += `
${s}`;
  }
  return n;
}
function Pn(e, t, r) {
  let n = e.data.summary,
    s = e.getIssueScenes(),
    a = pe(e, { levels: ["error"], limit: 5 }),
    i = fe(e, { status: "failed", limit: 5 }),
    l = e.listFiles();
  if (t === "json") {
    let h = {
      kind: "session",
      packPath: e.packPath,
      sessionId: e.sessionId,
      integrity: e.integrity,
      summary: n,
      issueScenes: s.map((m) => {
        let d = m.scene.narrative?.expected,
          p = typeof d == "string" ? d : d?.text,
          g =
            typeof d == "object" && d !== null
              ? (d.confidence ?? "missing")
              : p
                ? "explicit"
                : "missing";
        return {
          id: m.id,
          index: m.index,
          actual: m.scene.narrative?.actual ?? null,
          expected: p ?? null,
          expectedConfidence: g,
          originalSource: m.originalSource,
          annotatedSource: m.annotatedSource,
        };
      }),
      topConsoleErrors: a.items,
      topNetworkFailures: i.items,
      filesCount: l.length,
      files: l,
    };
    return $(JSON.stringify(h, null, 2), r);
  }
  let o = [];
  if (
    (e.integrity.schemaWarning &&
      o.push(`\u26A0\uFE0F ${e.integrity.schemaWarning}
`),
    e.integrity.valid ||
      o.push(`\u26A0\uFE0F Integrity check reported mismatches: ${e.integrity.mismatches.join("; ")}
`),
    o.push("# Bug Lens Evidence Pack (kind: session)"),
    o.push(`- **Session ID**: \`${e.sessionId}\``),
    o.push(
      `- **Schema**: v${e.integrity.schemaVersion ?? e.data.session?.schemaVersion ?? "?"} (integrity: ${e.integrity.valid ? "OK" : "MISMATCH"}, checked ${e.integrity.checkedCount} files)`
    ),
    o.push(
      `- **Page**: ${n?.title ?? e.data.session?.target?.initialTitle ?? "\u2014"} (${n?.url ?? e.data.session?.target?.initialUrl ?? "\u2014"})`
    ),
    o.push(
      `- **Duration**: ${U(n?.durationMs ?? e.data.session?.timeline?.durationMs)} | Quality: ${n?.quality ?? "\u2014"} | Privacy: ${n?.privacyMode ?? "\u2014"}`
    ),
    n?.environment)
  ) {
    let h = n.environment;
    o.push(
      `- **Environment**: ${h.os ?? "?"} \xB7 ${h.browser ?? "?"} \xB7 ${h.language ?? "?"} \xB7 screen ${h.screen ?? "?"} \xB7 viewport ${h.viewport ?? "?"}`
    );
  }
  if (
    (o.push(
      `- **Counts**: ${e.getInteractions().length} interactions | ${e.getConsoleEntries().length} console entries (${a.matchedCount} errors) | ${e.getNetworkEntries().length} network requests (${i.matchedCount} failed) | ${s.length} issue scenes | ${e.getFrameworkStates().length} framework snapshots`
    ),
    o.push(`
## Issue Scenes (${s.length})`),
    s.length === 0)
  )
    o.push("(No issue scenes marked in this session)");
  else
    for (let h of s) {
      let m = e.toRelativeMs(
          h.scene.selectionStartedAtEpochMs ?? h.scene.observedAtEpochMs
        ),
        d = h.scene.narrative?.expected,
        p = typeof d == "string" ? d : d?.text,
        g =
          typeof d == "object" && d !== null
            ? (d.confidence ?? "missing")
            : p
              ? "explicit"
              : "missing";
      (o.push(`- **Scene [${h.index}] \`${h.id}\`** (at ${C(m)}):`),
        o.push(`  - **actual**: ${h.scene.narrative?.actual || "(empty)"}`),
        o.push(
          `  - **expected** [confidence=${g}]: ${p || "(not captured \u2014 treat any expectation as inferred hypothesis)"}`
        ),
        o.push(
          `  - **screenshots**: annotated=\`${h.annotatedSource ?? "none"}\`, original=\`${h.originalSource ?? "none"}\``
        ));
      let y = h.annotatedSource ?? h.originalSource;
      if (y) {
        let v = ue(e, y);
        v &&
          o.push(
            `  - **savedImagePath**: \`${v}\` (call \`read_file\` on this path to view the scene screenshot)`
          );
      }
    }
  if (
    (o.push(`
## Top Console Errors (${a.matchedCount} total)`),
    a.items.length === 0)
  )
    o.push("(No console errors recorded)");
  else for (let h of a.items) o.push(`- ${me(h)}`);
  if (
    (o.push(`
## Top Failed Network Requests (${i.matchedCount} total)`),
    i.items.length === 0)
  )
    o.push("(No failed network requests recorded)");
  else for (let h of i.items) o.push(`- ${he(h)}`);
  o.push(`
## Package Files (${l.length})`);
  let u = l.filter(
      (h) =>
        !h.path.startsWith("screenshots/") &&
        !h.path.startsWith("network/body-")
    ),
    c = l.filter((h) => h.path.startsWith("network/body-")).length,
    f = l.filter((h) => h.path.startsWith("screenshots/")).length;
  for (let h of u)
    o.push(
      `- \`${h.path}\` (${h.byteLength} B${h.skippedMedia ? ", skipped in-memory load" : ""})`
    );
  return (
    c > 0 && o.push(`- \`network/body-*.txt\` (${c} split body files)`),
    f > 0 && o.push(`- \`screenshots/step-*.*\` (${f} step screenshots)`),
    o.push(
      '\n**Next steps** (active pack is cached; omit `--pack` in subsequent commands): Run `get_scene` to inspect DOM targets & annotated screenshot, `timeline --windowMs 15000` for chronological events around the issue, `query_network --status failed` / `get_request <id> --jsonPath "..."` for API bodies, or `get_framework_state` for Vue/React state.'
    ),
    $(
      o.join(`
`),
      r
    )
  );
}
function In(e, t, r) {
  let n = e.domContext,
    s = n?.anchors ?? [],
    a = e.listFiles();
  if (t === "json")
    return $(
      JSON.stringify(
        {
          kind: "screenshot",
          packPath: e.packPath,
          screenshotPath: e.getScreenshotImagePath(),
          environment: e.environment,
          smallestCommonAncestorSelector: n?.smallestCommonAncestorSelector,
          meta: n?.meta,
          anchors: s.map((m) => ({
            selector: m.selector,
            selectorPath: m.selectorPath,
            tagName: m.tagName,
            componentName: m.componentName,
            componentFile: m.componentFile,
            intentFlags: m.intentFlags,
            innerText: m.innerText?.slice(0, 120),
          })),
          hasCascade: !!e.cascade,
          files: a,
        },
        null,
        2
      ),
      r
    );
  let i = [],
    l = e.environment,
    o = l?.recentConsoleErrors ?? [],
    u = l?.recentFailedRequests ?? [],
    c = l?.frameworkComponentStates ?? l?.vueComponentStates ?? [],
    f = e.getScreenshotImagePath(),
    h = f ? ue(e, f) : void 0;
  if (
    (i.push("# Bug Lens Screenshot Pack (kind: screenshot)"),
    i.push(
      `- **Image**: \`${f ?? "none"}\`${h ? ` -> Saved to \`${h}\` (call \`read_file\` on this path to inspect visually)` : ""}`
    ),
    l &&
      (i.push(`- **Page**: ${l.title ?? "\u2014"} (${l.url ?? "\u2014"})`),
      i.push(
        `- **Viewport**: ${l.viewport?.width ?? "?"}x${l.viewport?.height ?? "?"} (${l.mediaBreakpoint ?? "?"}) | UA: ${l.userAgent ?? "\u2014"}`
      ),
      i.push(
        `- **Anomalies & State**: ${o.length} recent console error(s) | ${u.length} failed request(s) | ${c.length} component state snapshot(s)`
      )),
    n)
  ) {
    i.push(
      `- **DOM Context**: SCA=\`${n.smallestCommonAncestorSelector ?? "?"}\` | anchors=${n.meta?.anchorCount ?? s.length}, leaves=${n.meta?.leafCount ?? n.leaves?.length ?? 0}, ancestors=${n.meta?.ancestorCount ?? n.ancestors?.length ?? 0}`
    );
    let m = de(n);
    if (m.length > 0) {
      i.push(`
## Layout & Overflow Diagnostics (${m.length} distinct issue group(s))`);
      for (let g of m) {
        let y =
            g.anchorIndices.length > 0
              ? ` (anchors: [${g.anchorIndices.slice(0, 6).join(", ")}${g.anchorIndices.length > 6 ? `, ... (${g.anchorIndices.length} total)` : ""}])`
              : "",
          v = g.component ? ` [${g.component}]` : "";
        (i.push(
          `- \u26A0\uFE0F **[${g.kind}] \`${g.selectorPath ?? g.selector}\`**${v}${y}: ${g.summary}`
        ),
          g.sampleText && i.push(`  - sampleText: "${g.sampleText}"`),
          g.keyStyles &&
            i.push(`  - keyComputedStyles: ${JSON.stringify(g.keyStyles)}`));
      }
    }
    i.push(`
## Annotated DOM Anchors (${s.length})`);
    let d = new Map(),
      p = [];
    s.forEach((g, y) => {
      let v = `${g.selectorPath ?? g.selector ?? "?"}|${g.componentName ?? ""}|${JSON.stringify(g.intentFlags ?? {})}`,
        x = d.get(v);
      x ? x.push(y) : (d.set(v, [y]), p.push({ idx: y, anchor: g, sig: v }));
    });
    for (let { idx: g, anchor: y, sig: v } of p.slice(0, 15)) {
      let x = d.get(v) ?? [g],
        w =
          x.length > 1
            ? ` (+${x.length - 1} siblings: [${x.slice(1, 5).join(",")}${x.length > 5 ? ",..." : ""}])`
            : "",
        S = [];
      (y.intentFlags?.isArrowTarget && S.push("arrow"),
        y.intentFlags?.isHighlightedFocus && S.push("focus"),
        y.intentFlags?.textComment &&
          S.push(`comment="${y.intentFlags.textComment}"`));
      let b = S.length > 0 ? ` [${S.join(",")}]` : "",
        I = y.componentName
          ? ` [${y.componentName}${y.componentFile ? ` @ ${y.componentFile}${y.componentLine ? `:${y.componentLine}` : ""}` : ""}]`
          : "",
        P = y.selectorPath ?? y.selector ?? "?",
        L = P.length > 75 ? `\u2026${P.slice(-72)}` : P,
        H = (y.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 50);
      i.push(`- [${g}] \`${L}\`${I}${b}${w}${H ? ` text="${H}"` : ""}`);
    }
    p.length > 15 &&
      i.push(
        `- ... +${p.length - 15} more unique anchors (use \`get_scene(selector="...")\` to filter)`
      );
  }
  if ((e.cascade && i.push(...gt(e.cascade)), o.length > 0)) {
    i.push(`
## Recent Console Errors (${o.length})`);
    for (let [m, d] of o.slice(0, 5).entries())
      i.push(`- [#${m}] ${d.message ?? ""}`);
  }
  if (u.length > 0) {
    i.push(`
## Recent Failed Network Requests (${u.length})`);
    for (let m of u.slice(0, 5))
      i.push(`- ${m.method ?? "GET"} ${m.status ?? 0} ${m.url ?? ""}`);
  }
  i.push(`
## Files (${a.length})`);
  for (let m of a) i.push(`- \`${m.path}\` (${m.byteLength} B)`);
  return (
    i.push(
      '\n**Next steps** (active pack is cached; omit `--pack` in subsequent commands): Call `read_file` on the saved image path above to inspect `screenshot.jpg`; run `get_scene --selector "..." --cssProperty "..."` to inspect anchor `computedStyles`/`layoutContext` and matched CSS cascade rules; run `search_pack "<keyword>"` to search across `cascade.json` & `dom-context.json`; or run `get_framework_state` for component props/data.'
    ),
    $(
      i.join(`
`),
      r
    )
  );
}
function wt(e) {
  let t = M(e.pack),
    r = e.format ?? "text";
  return t.kind === "session" ? Pn(t, r, e.maxChars) : In(t, r, e.maxChars);
}
function St(e) {
  let t = M(e.pack);
  if (t.kind === "screenshot") {
    let a = t.environment?.recentConsoleErrors ?? [],
      i = e.search?.toLowerCase(),
      l = e.regex ? new RegExp(e.regex, "i") : void 0,
      o = a.filter((c) => {
        let f = `${c.message ?? ""}
${c.stack ?? ""}`;
        return !((i && !f.toLowerCase().includes(i)) || (l && !l.test(f)));
      });
    if (e.format === "json")
      return $(
        JSON.stringify(
          { totalEntries: a.length, matchedCount: o.length, items: o },
          null,
          2
        ),
        e.maxChars
      );
    let u = [
      `# Screenshot Pack Console Errors (${o.length} of ${a.length})`,
      ...o.map(
        (c, f) =>
          `[#${f}] [ERROR] ${c.message ?? ""}${
            c.stack
              ? `
    ${c.stack
      .split(
        `
`
      )
      .slice(0, 4).join(`
    `)}`
              : ""
          }`
      ),
    ];
    return $(
      u.join(`
`),
      e.maxChars
    );
  }
  let r = pe(t, {
    levels: e.levels,
    search: e.search,
    regex: e.regex,
    fromMs: e.fromMs,
    toMs: e.toMs,
    offset: e.offset,
    limit: e.limit,
  });
  if (e.format === "json") return $(JSON.stringify(r, null, 2), e.maxChars);
  let n = [];
  if (
    (n.push(
      `# Console Logs (matched ${r.matchedCount} of ${r.totalEntries} total, showing offset=${r.offset}..${r.offset + r.items.length})`
    ),
    r.items.length === 0)
  )
    n.push("(No console entries matched the given filters)");
  else for (let a of r.items) n.push(me(a));
  let s = r.matchedCount - (r.offset + r.items.length);
  return (
    s > 0 &&
      n.push(`
\u2026 ${s} more entries available. Use offset=${r.offset + r.items.length} to continue.`),
    $(
      n.join(`
`),
      e.maxChars
    )
  );
}
function $t(e) {
  let t = M(e.pack);
  if (t.kind === "screenshot") {
    let a = t.environment?.recentFailedRequests ?? [],
      i = e.urlContains?.toLowerCase(),
      l = e.method?.toUpperCase(),
      o = a.filter(
        (c) =>
          !(
            (i && !(c.url ?? "").toLowerCase().includes(i)) ||
            (l && (c.method ?? "GET").toUpperCase() !== l)
          )
      );
    if (e.format === "json")
      return $(
        JSON.stringify(
          { totalEntries: a.length, matchedCount: o.length, items: o },
          null,
          2
        ),
        e.maxChars
      );
    let u = [
      `# Screenshot Pack Failed Network Requests (${o.length} of ${a.length})`,
      ...o.map(
        (c, f) =>
          `- [#${f}] ${c.method ?? "GET"} !${c.status ?? 0} ${c.statusText ?? ""} | ${c.url ?? ""}`
      ),
    ];
    return $(
      u.join(`
`),
      e.maxChars
    );
  }
  let r = fe(t, {
    status: e.status,
    urlContains: e.urlContains,
    method: e.method,
    type: e.type,
    offset: e.offset,
    limit: e.limit,
  });
  if (e.format === "json") return $(JSON.stringify(r, null, 2), e.maxChars);
  let n = [];
  if (
    (n.push(
      `# Network Requests (matched ${r.matchedCount} of ${r.totalEntries} total, showing offset=${r.offset}..${r.offset + r.items.length})`
    ),
    r.items.length === 0)
  )
    n.push("(No network requests matched the given filters)");
  else for (let a of r.items) n.push(`- ${he(a)}`);
  let s = r.matchedCount - (r.offset + r.items.length);
  return (
    s > 0 &&
      n.push(`
\u2026 ${s} more requests available. Use offset=${r.offset + r.items.length} to continue, or call get_request(id) to inspect a specific request.`),
    $(
      n.join(`
`),
      e.maxChars
    )
  );
}
function Ct(e) {
  let t = M(e.pack),
    r = e.path.replace(/^\.?\//, ""),
    n = t.getTextFile(r);
  if (n === void 0) {
    let o = t
      .listFiles()
      .map((u) => u.path)
      .slice(0, 30)
      .join(", ");
    throw new Error(
      `FILE_NOT_FOUND_IN_PACK: "${r}" does not exist in pack. Available files sample: [${o}]`
    );
  }
  if (e.jsonPath) {
    let o;
    if (r.endsWith(".js")) o = V(n, r);
    else
      try {
        o = JSON.parse(n);
      } catch (c) {
        let f = c instanceof Error ? c.message : String(c);
        throw new Error(
          `INVALID_JSON_FILE: Cannot apply jsonPath "${e.jsonPath}" to "${r}": ${f}`
        );
      }
    let u = J(o, e.jsonPath);
    return $(JSON.stringify(u, null, 2), e.maxChars ?? 24e3);
  }
  let s = Math.max(0, e.offset ?? 0),
    a = e.maxChars ?? 24e3,
    i = n.slice(s),
    l = s + a;
  return $(
    i,
    a,
    n.length > l
      ? `Use offset=${l} to read the next chunk (total ${n.length} chars).`
      : void 0
  );
}
function Fe(e, t, r = 180, n = 3) {
  let s = t.includes("svg")
      ? e
      : e.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "<svg/>"),
    a = s.toLowerCase(),
    i = [],
    l = 0;
  for (; l < a.length && i.length < n;) {
    let o = a.indexOf(t, l);
    if (o < 0) break;
    let u = Math.max(0, o - r),
      c = Math.min(s.length, o + t.length + r),
      f = i[i.length - 1];
    (f && u <= f.end
      ? (f.end = Math.max(f.end, c))
      : i.push({ start: u, end: c }),
      (l = o + Math.max(1, t.length)));
  }
  return i.length === 0
    ? [
        s
          .slice(0, r * 2)
          .replace(/\s+/g, " ")
          .trim(),
      ]
    : i.map(({ start: o, end: u }) => {
        let c = o > 0 ? "\u2026" : "",
          f = u < s.length ? "\u2026" : "";
        return c + s.slice(o, u).replace(/\s+/g, " ").trim() + f;
      });
}
function bt(e, t) {
  let r = t.query.trim();
  if (!r) return { query: r, totalHits: 0, hits: [] };
  let n = r.toLowerCase(),
    s = new Set(
      t.scopes && t.scopes.length > 0
        ? t.scopes
        : [
            "console",
            "network-url",
            "network-body",
            "interactions",
            "framework",
          ]
    ),
    a = Math.max(1, t.limit ?? 30),
    i = Math.min(2e3, Math.max(40, t.contextChars ?? 180)),
    l = [];
  if (
    (s.has("console") &&
      e.getConsoleEntries().forEach((o, u) => {
        let c = `${o.text ?? ""} ${o.url ?? ""} ${o.stackTrace ?? o.stack ?? ""}`;
        if (c.toLowerCase().includes(n)) {
          let f = e.toRelativeMs(o.createdAt),
            [h] = Fe(c, n, i, 1);
          l.push({
            scope: "console",
            ref: `console#${u}`,
            relativeMs: f,
            snippet: `${C(f)} [${o.level ?? "log"}] ${h}`,
          });
        }
      }),
    s.has("network-url"))
  ) {
    for (let o of e.getNetworkEntries())
      if (o.url.toLowerCase().includes(n)) {
        let u = e.toRelativeMs(o.createdAt);
        l.push({
          scope: "network-url",
          ref: o.id,
          relativeMs: u,
          snippet: `${C(u)} ${o.method ?? "GET"} ${o.status ?? 0} ${o.url}`,
        });
      }
  }
  if (s.has("network-body"))
    for (let o of e.getNetworkEntries()) {
      let u = e.getNetworkBody(o);
      if (u && u.toLowerCase().includes(n)) {
        let c = e.toRelativeMs(o.createdAt),
          f = Fe(u, n, i, 3);
        for (let h of f)
          l.push({
            scope: "network-body",
            ref: o.id,
            relativeMs: c,
            snippet: `${C(c)} (${o.url}) ${h}`,
          });
      }
    }
  return (
    s.has("interactions") &&
      e.getInteractions().forEach((o, u) => {
        let c = X(o, u, e.toRelativeMs(o.createdAt)),
          f = JSON.stringify(o.element ?? o.target ?? {});
        (c.toLowerCase().includes(n) || f.toLowerCase().includes(n)) &&
          l.push({
            scope: "interactions",
            ref: `interaction#${u}`,
            relativeMs: e.toRelativeMs(o.createdAt),
            snippet: c,
          });
      }),
    s.has("framework") &&
      e.getFrameworkStates().forEach((o, u) => {
        let c = JSON.stringify(o);
        if (c.toLowerCase().includes(n)) {
          let f = e.toRelativeMs(o.capturedAtEpochMs),
            h = Fe(c, n, i, 2);
          for (let m of h)
            l.push({
              scope: "framework",
              ref: `frameworkState#${u}`,
              relativeMs: f,
              snippet: `${C(f)} [trigger=${o.trigger ?? "?"}] ${m}`,
            });
        }
      }),
    { query: r, totalHits: l.length, hits: l.slice(0, a) }
  );
}
function An(e, t, r = 30, n = 180) {
  let s = t.trim().toLowerCase();
  if (!s) return { totalHits: 0, hits: [] };
  let a = [];
  if (
    ((e.domContext?.anchors ?? []).forEach((o, u) => {
      if (
        JSON.stringify({
          selector: o.selector,
          selectorPath: o.selectorPath,
          componentName: o.componentName,
          componentFile: o.componentFile,
          innerText: o.innerText,
          computedStyles: o.computedStyles,
          layoutContext: o.layoutContext,
          intentFlags: o.intentFlags,
        })
          .toLowerCase()
          .includes(s)
      ) {
        let f = o.componentName
            ? ` [${o.componentName}${o.componentFile ? ` @ ${o.componentFile}:${o.componentLine ?? ""}` : ""}]`
            : "",
          h = o.layoutContext?.textOverflow?.reason;
        a.push({
          category: "dom-anchor",
          ref: `anchor#${u}`,
          detail: `\`${o.selectorPath ?? o.selector ?? "?"}\`${f} text="${(o.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 80)}"${h ? ` | overflow: ${h}` : ""} | styles=${JSON.stringify(o.computedStyles ?? {})}`,
        });
      }
    }),
    e.cascade)
  ) {
    let o = e.cascade.sheets ?? [],
      u = e.cascade.rules ?? [],
      c = e.cascade.elements ?? [],
      f = new Map();
    for (let p of o) f.set(p.id, p);
    let h = new Map();
    for (let p of u) h.set(p.id, p);
    let m = new Map();
    for (let p of c) {
      let g = `${p.id}(${p.selector})`;
      for (let y of p.matchedRuleIds ?? []) {
        let v = m.get(y);
        v ? v.push(g) : m.set(y, [g]);
      }
    }
    for (let p of o)
      (p.id.toLowerCase() === s ||
        (p.href && p.href.toLowerCase().includes(s))) &&
        a.push({
          category: "cascade-sheet",
          ref: p.id,
          detail: `href=${p.href ?? "inline"} (${p.rulesCount ?? 0} rules, tag=<${p.ownerNodeTag ?? "style"}>)`,
        });
    for (let [p, g] of c.entries())
      if (g.id.toLowerCase() === s || g.selector.toLowerCase().includes(s)) {
        let y = (g.matchedRuleIds ?? [])
          .slice(-6)
          .map((v) => {
            let x = h.get(v);
            return x ? `${v}:${x.selectorText}` : v;
          })
          .join(", ");
        a.push({
          category: "cascade-element",
          ref: `${g.id} (index ${p})`,
          detail: `<${g.tagName}> \`${g.selector}\` (${(g.matchedRuleIds ?? []).length} matched rules, e.g. [${y}])`,
        });
      }
    let d = new Map();
    for (let p of u)
      if (
        p.id.toLowerCase() === s ||
        p.selectorText.toLowerCase().includes(s) ||
        p.cssText.toLowerCase().includes(s)
      ) {
        let g = `${p.selectorText}||${p.cssText}`,
          y = f.get(p.sheetId),
          v = y?.href ? `${p.sheetId} (${y.href})` : `${p.sheetId} (inline)`,
          x = m.get(p.id) ?? [],
          w = d.get(g);
        if (w) {
          (w.ruleIds.push(p.id), w.sheetRefs.add(v));
          for (let S of x) w.matchedElements.add(S);
        } else
          d.set(g, {
            rule: p,
            ruleIds: [p.id],
            sheetRefs: new Set([v]),
            matchedElements: new Set(x),
          });
      }
    for (let p of d.values()) {
      let g =
          p.ruleIds.length > 3
            ? `${p.ruleIds.slice(0, 3).join(", ")} (+${p.ruleIds.length - 3})`
            : p.ruleIds.join(", "),
        y = Array.from(p.sheetRefs).slice(0, 2).join(" | "),
        v = Array.from(p.matchedElements),
        x =
          v.length > 0
            ? ` | matchedElements: [${v.slice(0, 5).join(", ")}${v.length > 5 ? ", ..." : ""}]`
            : "";
      a.push({
        category: "cascade-rule",
        ref: g,
        detail: `[sheet: ${y}] \`${p.rule.selectorText}\` -> \`${p.rule.cssText}\`${x}`,
      });
    }
  }
  if (
    ((
      e.environment?.frameworkComponentStates ??
      e.environment?.vueComponentStates ??
      []
    ).forEach((o, u) => {
      JSON.stringify(o).toLowerCase().includes(s) &&
        a.push({
          category: "component-state",
          ref: `${o.componentName ?? "Component"}#${u}`,
          detail: `${o.componentFile ? `@ ${o.componentFile}:${o.componentLine ?? ""} ` : ""}props=${JSON.stringify(o.props ?? {})} data=${JSON.stringify(o.data ?? o.state ?? {})}`,
        });
    }),
    a.length === 0)
  ) {
    for (let o of e.listFiles())
      if (o.path.endsWith(".json") || o.path.endsWith(".md")) {
        let u = e.getTextFile(o.path) ?? "",
          c = u.toLowerCase().indexOf(s);
        if (c >= 0) {
          let f = Math.max(0, c - n),
            h = Math.min(u.length, c + s.length + n);
          a.push({
            category: "file",
            ref: o.path,
            detail: u.slice(f, h).replace(/\s+/g, " ").trim(),
          });
        }
      }
  }
  return { totalHits: a.length, hits: a.slice(0, r) };
}
function Mt(e) {
  let t = M(e.pack),
    r = Math.min(2e3, Math.max(40, e.contextChars ?? 180));
  if (t.kind === "screenshot") {
    let a = An(t, e.query, e.limit ?? 30, r);
    if (e.format === "json")
      return $(
        JSON.stringify(
          { query: e.query, totalHits: a.totalHits, hits: a.hits },
          null,
          2
        ),
        e.maxChars
      );
    let i = [
      `# Search Results in Screenshot Pack for "${e.query}" (showing ${a.hits.length} of ${a.totalHits} total hits)`,
      ...(a.hits.length === 0
        ? [
            "(No matches found in dom-context.json, cascade.json, or environment.json)",
          ]
        : a.hits.map(
            (l) => `- **[${l.category}]** \`${l.ref}\` \u2014 ${l.detail}`
          )),
    ];
    return $(
      i.join(`
`),
      e.maxChars
    );
  }
  let n = bt(t, {
    query: e.query,
    scopes: e.scopes,
    limit: e.limit,
    contextChars: e.contextChars,
  });
  if (e.format === "json") return $(JSON.stringify(n, null, 2), e.maxChars);
  let s = [];
  if (
    (s.push(
      `# Search Hits for "${n.query}" (showing ${n.hits.length} of ${n.totalHits} total hits)`
    ),
    n.hits.length === 0)
  )
    s.push("(No matches found across requested scopes)");
  else
    for (let a of n.hits)
      s.push(`- **[${a.scope}]** \`${a.ref}\` \u2014 ${a.snippet}`);
  return $(
    s.join(`
`),
    e.maxChars
  );
}
function Et(e, t = {}) {
  let r = new Set(
      t.kinds && t.kinds.length > 0
        ? t.kinds
        : ["interaction", "console", "network", "scene"]
    ),
    n = t.fromMs,
    s = t.toMs,
    a = "Full session timeline";
  if (
    t.aroundSceneId !== void 0 ||
    (n === void 0 && s === void 0 && t.windowMs !== void 0)
  ) {
    let u = e.getIssueScenes(),
      c = t.aroundSceneId
        ? (u.find(
            (f) =>
              f.id === t.aroundSceneId || String(f.index) === t.aroundSceneId
          ) ?? u[0])
        : u[0];
    if (c) {
      let f =
          c.scene.selectionStartedAtEpochMs ??
          c.scene.observedAtEpochMs ??
          c.scene.sequenceContext?.anchorEpochMs,
        h = e.toRelativeMs(f);
      if (h !== void 0) {
        let m = t.windowMs ?? 15e3;
        ((n = h - m),
          (s = h + Math.min(5e3, Math.floor(m / 3))),
          (a = `Around scene "${c.id}" (${C(n)} .. ${C(s)})`));
      }
    }
  } else
    (n !== void 0 || s !== void 0) &&
      (a = `Range ${C(n ?? 0)} .. ${C(s ?? 1 / 0)}`);
  let i = [];
  if (
    (r.has("interaction") &&
      e.getInteractions().forEach((c, f) => {
        let h = e.toRelativeMs(c.createdAt) ?? c.elapsedMs ?? 0,
          m = c.createdAt ?? e.toEpochMs(h);
        i.push({
          kind: "interaction",
          epochMs: m,
          relativeMs: h,
          refId: f,
          summary: X(c, f, h),
        });
      }),
    r.has("console") &&
      e.getConsoleEntries().forEach((c, f) => {
        let h = (c.level ?? "log").toLowerCase();
        if (
          !t.includeAllConsole &&
          h !== "error" &&
          h !== "warning" &&
          h !== "warn"
        )
          return;
        let m = e.toRelativeMs(c.createdAt) ?? 0,
          d = c.createdAt ?? e.toEpochMs(m),
          p = (c.text ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
        i.push({
          kind: "console",
          epochMs: d,
          relativeMs: m,
          refId: c.id ?? f,
          summary: `${C(m)} [console.${h}] ${p}`,
        });
      }),
    r.has("network") &&
      e.getNetworkEntries().forEach((c) => {
        let f = c.status ?? 0,
          h = f === 0 || f >= 400 || !!c.errorText,
          m = (c.type ?? "").toLowerCase(),
          d = m === "xhr" || m === "fetch" || m === "document";
        if (!t.includeAllNetwork && !h && !d) return;
        let p = e.toRelativeMs(c.createdAt) ?? 0,
          g = c.createdAt ?? e.toEpochMs(p),
          y = c.method ?? "GET",
          v = U(c.durationMs),
          x = h ? `!${f || "ERR"}` : String(f);
        i.push({
          kind: "network",
          epochMs: g,
          relativeMs: p,
          refId: c.id,
          summary: `${C(p)} [net ${y} ${x} ${v}] ${c.url} (id=${c.id})`,
        });
      }),
    r.has("scene"))
  )
    for (let u of e.getIssueScenes()) {
      let c = u.scene.selectionStartedAtEpochMs ?? u.scene.observedAtEpochMs,
        f = e.toRelativeMs(c) ?? 0,
        h = u.scene.narrative?.actual ?? "(no narrative)";
      i.push({
        kind: "scene",
        epochMs: c ?? e.toEpochMs(f),
        relativeMs: f,
        refId: u.id,
        summary: `${C(f)} [ISSUE SCENE ${u.id}] actual="${h}"`,
      });
    }
  let l = i
      .filter(
        (u) =>
          !(
            (n !== void 0 && u.relativeMs < n) ||
            (s !== void 0 && u.relativeMs > s)
          )
      )
      .sort((u, c) => u.relativeMs - c.relativeMs),
    o = t.limit ?? 80;
  return {
    windowDescription: a,
    totalMatched: l.length,
    events: l.slice(0, o),
  };
}
function Nt(e) {
  let t = M(e.pack);
  if (t.kind !== "session")
    throw new Error(
      `UNSUPPORTED_PACK_KIND: timeline requires a session evidence pack, but "${e.pack}" is a screenshot pack.`
    );
  let r = Et(t, {
    aroundSceneId: e.aroundSceneId,
    fromMs: e.fromMs,
    toMs: e.toMs,
    windowMs: e.windowMs,
    kinds: e.kinds,
    includeAllConsole: e.includeAllConsole,
    includeAllNetwork: e.includeAllNetwork,
    limit: e.limit,
  });
  if (e.format === "json") return $(JSON.stringify(r, null, 2), e.maxChars);
  let n = [];
  if (
    (n.push(
      `# Unified Timeline (${r.windowDescription}) \u2014 showing ${r.events.length} of ${r.totalMatched} events`
    ),
    r.events.length === 0)
  )
    n.push("(No events matched the specified time window and filters)");
  else for (let s of r.events) n.push(`- ${s.summary}`);
  return (
    r.totalMatched > r.events.length &&
      n.push(`
\u2026 ${r.totalMatched - r.events.length} more events omitted. Pass a higher \`limit\` or narrow \`fromMs\`/\`toMs\`.`),
    $(
      n.join(`
`),
      e.maxChars
    )
  );
}
function On(e) {
  let t = {},
    r = [];
  for (let s = 0; s < e.length; s++) {
    let a = e[s];
    if (a === "--") {
      r.push(...e.slice(s + 1));
      break;
    }
    if (a.startsWith("--")) {
      let l = a.indexOf("=");
      if (l > 2) {
        let o = a.slice(2, l),
          u = a.slice(l + 1);
        t[o] = u;
      } else {
        let o = a.slice(2),
          u = e[s + 1];
        u !== void 0 && !u.startsWith("--") ? ((t[o] = u), s++) : (t[o] = !0);
      }
      continue;
    }
    let i = /^([a-zA-Z][a-zA-Z0-9_]*)=(.+)$/.exec(a);
    if (i && !ye(a)) {
      t[i[1]] = i[2];
      continue;
    }
    r.push(a);
  }
  let n =
    typeof t.json == "string"
      ? t.json
      : r[0]?.trim().startsWith("{")
        ? r.shift()
        : void 0;
  if (n)
    try {
      let s = JSON.parse(n);
      for (let [a, i] of Object.entries(s))
        typeof i == "boolean" || typeof i == "string"
          ? (t[a] = i)
          : typeof i == "number"
            ? (t[a] = String(i))
            : Array.isArray(i) && (t[a] = i.join(","));
    } catch {}
  return { flags: t, positionals: r };
}
function E(e, ...t) {
  for (let r of t) {
    let n = e[r];
    if (typeof n == "string" && n.trim().length > 0) return n.trim();
  }
}
function N(e, ...t) {
  let r = E(e, ...t);
  if (r === void 0) return;
  let n = Number(r);
  return Number.isFinite(n) ? n : void 0;
}
function ge(e, ...t) {
  for (let r of t) {
    let n = e[r];
    if (typeof n == "boolean") return n;
    if (typeof n == "string") {
      let s = n.trim().toLowerCase();
      if (s === "true" || s === "1" || s === "yes") return !0;
      if (s === "false" || s === "0" || s === "no") return !1;
    }
  }
}
function re(e, ...t) {
  let r = E(e, ...t);
  if (!r) return;
  let n = r
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return n.length > 0 ? n : void 0;
}
function Fn(e) {
  return e ? (/\.zip$/i.test(e) ? !0 : ye(e)) : !1;
}
function F(e, t, r = !1) {
  let n = E(e, "pack", "p");
  return n
    ? { pack: n, rest: t }
    : t.length > 0 && (r || Fn(t[0]))
      ? { pack: t[0], rest: t.slice(1) }
      : { pack: void 0, rest: t };
}
function Le(e) {
  return e.filter((t) => t.type === "text").map((t) => t.text).join(`

`);
}
function Ln() {
  return `Bug Lens Evidence Triage CLI
Usage: node bug-lens-cli.mjs <command> [options]

Commands:
  open_pack <zipPath>                         Open pack in memory, cache session path, export key screenshots, and print overview
  get_scene [--selector S] [--cssProperty P]  Inspect issue scene (session) or DOM anchor & CSS cascade rules (screenshot)
  get_screenshot [--kind K] [--step N]        Export screenshot image to temp workspace and print path
  timeline [--aroundSceneId ID] [--windowMs]  Unified chronological timeline of interactions, console errors, and network requests
  query_console [--levels error,warning]      Filter console logs and source-mapped stack traces
  query_network [--status failed|4xx|5xx]     Filter network requests (prioritizes failures)
  get_request <id> [--jsonPath EXPR]          Inspect request headers, initiator stack, and response body (with JSONPath)
  get_interactions [--fromIndex N] [--limit]  List recorded user interactions
  get_framework_state [--component NAME]      Inspect Vue/React component props, state, and webStorage snapshots
  search_pack <query>                         Cross-search console, network URLs/bodies, interactions, cascade rules, and state
  read_pack_file <path> [--jsonPath EXPR]     Read raw JSON/JS/text file inside the pack without extraction
  extract_pack [--dest DIR]                   Safely extract pack to disk to run Playwright reproduce.spec.ts`;
}
function jn(e) {
  let t = e[0]?.trim();
  if (
    !t ||
    t === "-h" ||
    t === "--help" ||
    t === "help" ||
    e.slice(1).some((l) => l === "-h" || l === "--help")
  )
    return Ln();
  let r = t.replace(/-/g, "_").toLowerCase(),
    { flags: n, positionals: s } = On(e.slice(1)),
    a = E(n, "format") === "json" ? "json" : "text",
    i = N(n, "maxChars", "max_chars");
  switch (r) {
    case "open_pack": {
      let { pack: l } = F(n, s, !0);
      if (!l)
        throw new Error(
          "Usage: bug-lens-cli.mjs open_pack <zipPath> [--format text|json]"
        );
      return wt({ pack: l, format: a, maxChars: i });
    }
    case "get_scene": {
      let { pack: l, rest: o } = F(n, s),
        u = N(n, "sceneIndex", "scene_index", "index"),
        c = E(n, "sceneId", "scene_id"),
        f = E(n, "selector", "s") ?? o[0],
        h = E(n, "cssProperty", "css_property", "prop"),
        m = ge(
          n,
          "includeImage",
          "include_image",
          "includeScreenshot",
          "include_screenshot"
        ),
        d = vt({
          pack: l,
          sceneId:
            c ?? (u === void 0 && o[0] && /^\d+$/.test(o[0]) ? o[0] : void 0),
          sceneIndex: u,
          selector: f,
          cssProperty: h,
          includeImage: m,
          format: a,
          maxChars: i,
        });
      return Le(d);
    }
    case "get_screenshot": {
      let { pack: l, rest: o } = F(n, s),
        u = E(n, "kind") ?? o[0],
        c = N(n, "step"),
        f = E(n, "sceneId", "scene_id"),
        h = xt({ pack: l, kind: u, step: c, sceneId: f });
      return Le(h);
    }
    case "timeline": {
      let { pack: l, rest: o } = F(n, s),
        u = E(n, "aroundSceneId", "around_scene_id", "around") ?? o[0],
        c = u?.startsWith("scene:")
          ? String(Math.max(0, Number(u.slice(6)) - 1))
          : u;
      return Nt({
        pack: l,
        aroundSceneId: c,
        fromMs: N(n, "fromMs", "from_ms"),
        toMs: N(n, "toMs", "to_ms"),
        windowMs: N(n, "windowMs", "window_ms"),
        kinds: re(n, "kinds", "kind"),
        includeAllConsole: ge(n, "includeAllConsole", "include_all_console"),
        includeAllNetwork: ge(n, "includeAllNetwork", "include_all_network"),
        limit: N(n, "limit"),
        format: a,
        maxChars: i,
      });
    }
    case "query_console": {
      let { pack: l, rest: o } = F(n, s);
      return St({
        pack: l,
        levels: re(n, "levels", "level"),
        search: E(n, "search", "query", "q") ?? o[0],
        regex: E(n, "regex"),
        fromMs: N(n, "fromMs", "from_ms"),
        toMs: N(n, "toMs", "to_ms"),
        offset: N(n, "offset"),
        limit: N(n, "limit"),
        format: a,
        maxChars: i,
      });
    }
    case "query_network": {
      let { pack: l, rest: o } = F(n, s),
        u = E(n, "status"),
        c = u && /^\d+(,\d+)*$/.test(u) ? u.split(",").map(Number) : u;
      return $t({
        pack: l,
        status: c,
        urlContains: E(n, "urlContains", "url_contains", "url") ?? o[0],
        method: E(n, "method"),
        type: E(n, "type"),
        offset: N(n, "offset"),
        limit: N(n, "limit"),
        format: a,
        maxChars: i,
      });
    }
    case "get_request": {
      let { pack: l, rest: o } = F(n, s),
        u = E(n, "id", "requestId", "request_id") ?? o[0];
      if (!u)
        throw new Error(
          "Usage: bug-lens-cli.mjs get_request <id> [--jsonPath EXPR]"
        );
      return mt({
        pack: l,
        id: u,
        include: re(n, "include"),
        jsonPath: E(n, "jsonPath", "json_path") ?? o[1],
        bodyMaxChars: N(n, "bodyMaxChars", "body_max_chars"),
        format: a,
        maxChars: i,
      });
    }
    case "get_interactions": {
      let { pack: l } = F(n, s),
        o = dt({
          pack: l,
          fromIndex: N(n, "fromIndex", "from_index"),
          limit: N(n, "limit"),
          kinds: re(n, "kinds", "kind"),
          includeScreenshot: ge(n, "includeScreenshot", "include_screenshot"),
          format: a,
          maxChars: i,
        });
      return Le(o);
    }
    case "get_framework_state": {
      let { pack: l, rest: o } = F(n, s);
      return ht({
        pack: l,
        index: N(n, "index"),
        nearMs: N(n, "nearMs", "near_ms"),
        component: E(n, "component") ?? o[0],
        path: E(n, "path", "jsonPath", "json_path"),
        format: a,
        maxChars: i,
      });
    }
    case "search_pack": {
      let { pack: l, rest: o } = F(n, s),
        u = E(n, "query", "q") ?? o[0];
      if (!u) throw new Error("Usage: bug-lens-cli.mjs search_pack <query>");
      return Mt({
        pack: l,
        query: u,
        scopes: re(n, "scopes", "scope"),
        limit: N(n, "limit"),
        contextChars: N(n, "contextChars", "context_chars"),
        format: a,
        maxChars: i,
      });
    }
    case "read_pack_file": {
      let { pack: l, rest: o } = F(n, s),
        u = E(n, "path", "file") ?? o[0];
      if (!u)
        throw new Error(
          "Usage: bug-lens-cli.mjs read_pack_file <path> [--jsonPath EXPR]"
        );
      return Ct({
        pack: l,
        path: u,
        jsonPath: E(n, "jsonPath", "json_path") ?? o[1],
        offset: N(n, "offset"),
        maxChars: i,
      });
    }
    case "extract_pack": {
      let { pack: l, rest: o } = F(n, s);
      return ft({ pack: l, dest: E(n, "dest", "d") ?? o[0], format: a });
    }
    default:
      throw new Error(
        `UNKNOWN_COMMAND: Unknown command "${t}". Run with --help to see available commands.`
      );
  }
}
function _n() {
  if (typeof process > "u" || !Array.isArray(process.argv) || !process.argv[1])
    return !1;
  let e = process.argv[1];
  if (e.endsWith("bug-lens-cli.mjs") || e.endsWith("cli.ts")) return !0;
  try {
    let t = Rn(import.meta.url),
      r = Tn(e),
      n = ye(r) ? Pt(r) : r,
      s = ye(t) ? Pt(t) : t;
    return n === s;
  } catch {
    return !1;
  }
}
var Dn = _n();
if (Dn)
  try {
    let e = jn(process.argv.slice(2));
    process.stdout.write(
      e +
        `
`
    );
  } catch (e) {
    let t = e instanceof Error ? e.message : String(e);
    (process.stderr.write(`Error: ${t}
`),
      process.exit(1));
  }
export { jn as runTriageCli };
