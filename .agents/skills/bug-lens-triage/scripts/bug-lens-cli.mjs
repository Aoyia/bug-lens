#!/usr/bin/env node
import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
import { existsSync as He, realpathSync as Nn } from "node:fs";
import { resolve as or } from "node:path";
import { fileURLToPath as ir } from "node:url";
function w(e, t = 24e3, s) {
  let n = typeof t == "number" && t > 200 ? Math.floor(t) : 24e3;
  if (e.length <= n) return e;
  let r = s
      ? ` ${s}`
      : " Pass a larger maxChars or narrower filter/jsonPath to inspect further.",
    i = `

\u2026 [Truncated to ${n} chars (original ${e.length} chars).${r}]`,
    c = Math.max(100, n - i.length),
    u = e.slice(0, c),
    o = u.lastIndexOf(`
`),
    d = o > c * 0.75 ? o : c;
  return u.slice(0, d).trimEnd() + i;
}
import { createRequire as Fn } from "module";
var Ln = Fn("/"),
  ce,
  On,
  jn;
try {
  ((ce = Ln("worker_threads")),
    (On = ce.Worker),
    (jn = ce.isMarkedAsUntransferable));
} catch {}
var j = Uint8Array,
  ae = Uint16Array,
  Bn = Int32Array,
  At = new j([
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5,
    5, 5, 5, 0, 0, 0, 0,
  ]),
  Rt = new j([
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10,
    11, 11, 12, 12, 13, 13, 0, 0,
  ]),
  Dn = new j([
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
  ]),
  Tt = function (e, t) {
    for (var s = new ae(31), n = 0; n < 31; ++n) s[n] = t += 1 << e[n - 1];
    for (var r = new Bn(s[30]), n = 1; n < 30; ++n)
      for (var i = s[n]; i < s[n + 1]; ++i) r[i] = ((i - s[n]) << 5) | n;
    return { b: s, r };
  },
  ce = Tt(At, 2),
  _t = ce.b,
  zn = ce.r;
((_t[28] = 258), (zn[258] = 28));
var Ft = Tt(Rt, 0),
  qn = Ft.b,
  gr = Ft.r,
  Ye = new ae(32768);
for (C = 0; C < 32768; ++C)
  ((W = ((C & 43690) >> 1) | ((C & 21845) << 1)),
    (W = ((W & 52428) >> 2) | ((W & 13107) << 2)),
    (W = ((W & 61680) >> 4) | ((W & 3855) << 4)),
    (Ye[C] = (((W & 65280) >> 8) | ((W & 255) << 8)) >> 1));
var W,
  C,
  ye = function (e, t, s) {
    for (var n = e.length, r = 0, i = new ae(t); r < n; ++r)
      e[r] && ++i[e[r] - 1];
    var c = new ae(t);
    for (r = 1; r < t; ++r) c[r] = (c[r - 1] + i[r - 1]) << 1;
    var u;
    if (s) {
      u = new ae(1 << t);
      var o = 15 - t;
      for (r = 0; r < n; ++r)
        if (e[r])
          for (
            var d = (r << 4) | e[r],
              a = t - e[r],
              l = c[e[r] - 1]++ << a,
              f = l | ((1 << a) - 1);
            l <= f;
            ++l
          )
            u[Ye[l] >> o] = d;
    } else
      for (u = new ae(n), r = 0; r < n; ++r)
        e[r] && (u[r] = Ye[c[e[r] - 1]++] >> (15 - e[r]));
    return u;
  },
  ve = new j(288);
for (C = 0; C < 144; ++C) ve[C] = 8;
var C;
for (C = 144; C < 256; ++C) ve[C] = 9;
var C;
for (C = 256; C < 280; ++C) ve[C] = 7;
var C;
for (C = 280; C < 288; ++C) ve[C] = 8;
var C,
  Lt = new j(32);
for (C = 0; C < 32; ++C) Lt[C] = 5;
var C;
var Un = ye(ve, 9, 1);
var Jn = ye(Lt, 5, 1),
  Ze = function (e) {
    for (var t = e[0], s = 1; s < e.length; ++s) e[s] > t && (t = e[s]);
    return t;
  },
  q = function (e, t, s) {
    var n = (t / 8) | 0;
    return ((e[n] | (e[n + 1] << 8)) >> (t & 7)) & s;
  },
  Ve = function (e, t) {
    var s = (t / 8) | 0;
    return (e[s] | (e[s + 1] << 8) | (e[s + 2] << 16)) >> (t & 7);
  },
  Wn = function (e) {
    return ((e + 7) / 8) | 0;
  },
  tt = function (e, t, s) {
    return (
      (t == null || t < 0) && (t = 0),
      (s == null || s > e.length) && (s = e.length),
      new j(e.subarray(t, s))
    );
  };
var Hn = [
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
  O = function (e, t, s) {
    var n = new Error(t || Hn[e]);
    if (
      ((n.code = e),
      Error.captureStackTrace && Error.captureStackTrace(n, O),
      !s)
    )
      throw n;
    return n;
  },
  Gn = function (e, t, s, n) {
    var r = e.length,
      i = n ? n.length : 0;
    if (!r || (t.f && !t.l)) return s || new j(0);
    var c = !s,
      u = c || t.i != 2,
      o = t.i;
    c && (s = new j(r * 3));
    var d = function (It) {
        var Nt = s.length;
        if (It > Nt) {
          var Pt = new j(Math.max(Nt * 2, It));
          (Pt.set(s), (s = Pt));
        }
      },
      a = t.f || 0,
      l = t.p || 0,
      f = t.b || 0,
      m = t.l,
      p = t.d,
      h = t.m,
      $ = t.n,
      g = r * 8;
    do {
      if (!m) {
        a = q(e, l, 1);
        var v = q(e, l + 1, 3);
        if (((l += 3), v))
          if (v == 1) ((m = Un), (p = Jn), (h = 9), ($ = 5));
          else if (v == 2) {
            var k = q(e, l, 31) + 257,
              b = q(e, l + 10, 15) + 4,
              P = k + q(e, l + 5, 31) + 1;
            l += 14;
            for (var R = new j(P), ee = new j(19), T = 0; T < b; ++T)
              ee[Dn[T]] = q(e, l + T * 3, 7);
            l += b * 3;
            for (
              var me = Ze(ee), Pn = (1 << me) - 1, An = ye(ee, me, 1), T = 0;
              T < P;
            ) {
              var kt = An[q(e, l, Pn)];
              l += kt & 15;
              var S = kt >> 4;
              if (S < 16) R[T++] = S;
              else {
                var oe = 0,
                  ke = 0;
                for (
                  S == 16
                    ? ((ke = 3 + q(e, l, 3)), (l += 2), (oe = R[T - 1]))
                    : S == 17
                      ? ((ke = 3 + q(e, l, 7)), (l += 3))
                      : S == 18 && ((ke = 11 + q(e, l, 127)), (l += 7));
                  ke--;
                )
                  R[T++] = oe;
              }
            }
            var bt = R.subarray(0, k),
              Z = R.subarray(k);
            ((h = Ze(bt)), ($ = Ze(Z)), (m = ye(bt, h, 1)), (p = ye(Z, $, 1)));
          } else O(1);
        else {
          var S = Wn(l) + 4,
            y = e[S - 4] | (e[S - 3] << 8),
            x = S + y;
          if (x > r) {
            o && O(0);
            break;
          }
          (u && d(f + y),
            s.set(e.subarray(S, x), f),
            (t.b = f += y),
            (t.p = l = x * 8),
            (t.f = a));
          continue;
        }
        if (l > g) {
          o && O(0);
          break;
        }
      }
      u && d(f + 131072);
      for (var Rn = (1 << h) - 1, Tn = (1 << $) - 1, Ge = l; ; Ge = l) {
        var oe = m[Ve(e, l) & Rn],
          ie = oe >> 4;
        if (((l += oe & 15), l > g)) {
          o && O(0);
          break;
        }
        if ((oe || O(2), ie < 256)) s[f++] = ie;
        else if (ie == 256) {
          ((Ge = l), (m = null));
          break;
        } else {
          var Et = ie - 254;
          if (ie > 264) {
            var T = ie - 257,
              ge = At[T];
            ((Et = q(e, l, (1 << ge) - 1) + _t[T]), (l += ge));
          }
          var Ke = p[Ve(e, l) & Tn],
            Xe = Ke >> 4;
          (Ke || O(3), (l += Ke & 15));
          var Z = qn[Xe];
          if (Xe > 3) {
            var ge = Rt[Xe];
            ((Z += Ve(e, l) & ((1 << ge) - 1)), (l += ge));
          }
          if (l > g) {
            o && O(0);
            break;
          }
          u && d(f + 131072);
          var Ct = f + Et;
          if (f < Z) {
            var Mt = i - Z,
              _n = Math.min(Z, Ct);
            for (Mt + f < 0 && O(3); f < _n; ++f) s[f] = n[Mt + f];
          }
          for (; f < Ct; ++f) s[f] = s[f - Z];
        }
      }
      ((t.l = m),
        (t.p = Ge),
        (t.b = f),
        (t.f = a),
        m && ((a = 1), (t.m = h), (t.d = p), (t.n = $)));
    } while (!a);
    return f != s.length && c ? tt(s, 0, f) : s.subarray(0, f);
  };
var Kn = new j(0);
var J = function (e, t) {
    return e[t] | (e[t + 1] << 8);
  },
  B = function (e, t) {
    return (e[t] | (e[t + 1] << 8) | (e[t + 2] << 16) | (e[t + 3] << 24)) >>> 0;
  },
  Qe = function (e, t) {
    return B(e, t) + B(e, t + 4) * 4294967296;
  };
function Xn(e, t) {
  return Gn(e, { i: 2 }, t && t.out, t && t.dictionary);
}
var et = typeof TextDecoder < "u" && new TextDecoder(),
  Zn = 0;
try {
  (et.decode(Kn, { stream: !0 }), (Zn = 1));
} catch {}
var Vn = function (e) {
  for (var t = "", s = 0; ;) {
    var n = e[s++],
      r = (n > 127) + (n > 223) + (n > 239);
    if (s + r > e.length) return { s: t, r: tt(e, s - 1) };
    r
      ? r == 3
        ? ((n =
            (((n & 15) << 18) |
              ((e[s++] & 63) << 12) |
              ((e[s++] & 63) << 6) |
              (e[s++] & 63)) -
            65536),
          (t += String.fromCharCode(55296 | (n >> 10), 56320 | (n & 1023))))
        : r & 1
          ? (t += String.fromCharCode(((n & 31) << 6) | (e[s++] & 63)))
          : (t += String.fromCharCode(
              ((n & 15) << 12) | ((e[s++] & 63) << 6) | (e[s++] & 63),
            ))
      : (t += String.fromCharCode(n));
  }
};
function Qn(e, t) {
  if (t) {
    for (var s = "", n = 0; n < e.length; n += 16384)
      s += String.fromCharCode.apply(null, e.subarray(n, n + 16384));
    return s;
  } else {
    if (et) return et.decode(e);
    var r = Vn(e),
      i = r.s,
      s = r.r;
    return (s.length && O(8), i);
  }
}
var Yn = function (e, t) {
    return t + 30 + J(e, t + 26) + J(e, t + 28);
  },
  es = function (e, t, s) {
    var n = J(e, t + 28),
      r = J(e, t + 30),
      i = Qn(e.subarray(t + 46, t + 46 + n), !(J(e, t + 8) & 2048)),
      c = t + 46 + n,
      u = ts(e, c, r, s, B(e, t + 20), B(e, t + 24), B(e, t + 42)),
      o = u[0],
      d = u[1],
      a = u[2];
    return [J(e, t + 10), o, d, i, c + r + J(e, t + 32), a];
  },
  ts = function (e, t, s, n, r, i, c) {
    var u = r == 4294967295,
      o = i == 4294967295,
      d = c == 4294967295,
      a = t + s,
      l = u + o + d;
    if (n && l) {
      for (; t + 4 < a; t += 4 + J(e, t + 2))
        if (J(e, t) == 1)
          return [
            u ? Qe(e, t + 4 + 8 * o) : r,
            o ? Qe(e, t + 4) : i,
            d ? Qe(e, t + 4 + 8 * (o + u)) : c,
            1,
          ];
      n < 2 && O(13);
    }
    return [r, i, c, 0];
  };
function Ot(e, t) {
  for (var s = {}, n = e.length - 22; B(e, n) != 101010256; --n)
    (!n || e.length - n > 65558) && O(13);
  var r = J(e, n + 8);
  if (!r) return {};
  var i = B(e, n + 16),
    c = B(e, n - 20) == 117853008;
  if (c) {
    var u = B(e, n - 12);
    ((c = B(e, u) == 101075792), c && ((r = B(e, u + 32)), (i = B(e, u + 48))));
  }
  for (var o = t && t.filter, d = 0; d < r; ++d) {
    var a = es(e, i, c),
      l = a[0],
      f = a[1],
      m = a[2],
      p = a[3],
      h = a[4],
      $ = a[5],
      g = Yn(e, $);
    ((i = h),
      (!o || o({ name: p, size: f, originalSize: m, compression: l })) &&
        (l
          ? l == 8
            ? (s[p] = Xn(e.subarray(g, g + f), { out: new j(m) }))
            : O(14, "unknown compression type " + l)
          : (s[p] = tt(e, g, g + f))));
  }
  return s;
}
import { createHash as ps } from "node:crypto";
import {
  copyFileSync as ms,
  existsSync as K,
  mkdirSync as Ae,
  readdirSync as Gt,
  readFileSync as Re,
  realpathSync as Kt,
  rmSync as Xt,
  statSync as at,
  writeFileSync as V,
} from "node:fs";
import { tmpdir as gs } from "node:os";
import {
  basename as ys,
  dirname as ct,
  join as A,
  posix as vs,
  resolve as D,
  sep as Jt,
} from "node:path";
var be = class {
  maxEntries;
  map = new Map();
  constructor(t = 3) {
    this.maxEntries = t;
  }
  get(t, s) {
    let n = this.map.get(t);
    if (n) {
      if (n.fingerprint !== s) {
        this.map.delete(t);
        return;
      }
      return (this.map.delete(t), this.map.set(t, n), n.pack);
    }
  }
  set(t, s, n) {
    if (this.map.has(t)) this.map.delete(t);
    else if (this.map.size >= this.maxEntries) {
      let r = this.map.keys().next().value;
      r !== void 0 && this.map.delete(r);
    }
    this.map.set(t, { fingerprint: s, pack: n });
  }
  getLastPath() {
    let t;
    for (let s of this.map.keys()) t = s;
    return t;
  }
  clear() {
    this.map.clear();
  }
};
function ns(e) {
  return Array.isArray(e)
    ? `array[${e.length}]`
    : e === null
      ? "null"
      : typeof e;
}
function le(e) {
  return !e || typeof e != "object" || Array.isArray(e)
    ? "\u2014"
    : Object.entries(e)
        .map(([t, s]) => `\`${t}\` (${ns(s)})`)
        .join(", ");
}
function nt(e) {
  if (!e || e.length === 0) return "\u2014";
  let t = new Set();
  for (let s of e.slice(0, 50))
    if (s && typeof s == "object" && !Array.isArray(s))
      for (let n of Object.keys(s)) t.add(n);
  return t.size > 0
    ? Array.from(t)
        .map((s) => `\`${s}\``)
        .join(", ")
    : "\u2014";
}
function st(e) {
  return e >= 1024 * 1024
    ? `${(e / 1024 / 1024).toFixed(1)} MB`
    : e >= 1024
      ? `${(e / 1024).toFixed(1)} KB`
      : `${e} B`;
}
function H(e) {
  return `"${e.replace(/(["\\$`])/g, "\\$1")}"`;
}
function G(e, t) {
  let s = e.includes("\\") && !e.includes("/") ? "\\" : "/";
  return `${e.replace(/[\\/]+$/, "")}${s}${t.split("/").join(s)}`;
}
function ss(e) {
  let t = e.listFiles(),
    s = [],
    n = new Map(),
    r = [];
  for (let i of t) {
    let c = i.path.startsWith("network/body-")
      ? "network/body-*.txt"
      : i.path.startsWith("network/blobs/")
        ? "network/blobs/*"
        : i.path.startsWith("screenshots/")
          ? "screenshots/*"
          : i.path.startsWith("issues/")
            ? "issues/*"
            : void 0;
    if (c) {
      let u = n.get(c) ?? { count: 0, bytes: 0 };
      ((u.count += 1), (u.bytes += i.byteLength), n.set(c, u));
    } else r.push(i);
  }
  (s.push(`## Files (${t.length} in original pack)`),
    s.push("| Path | Size | Note |"),
    s.push("| --- | --- | --- |"));
  for (let i of r) {
    let c = i.skippedMedia
      ? "recording (on disk only; not loaded by CLI)"
      : i.path === "data/session-data.js" ||
          i.path === "data/network-details.js"
        ? "JS wrapper \u2014 read the derived .json instead, never eval"
        : "";
    s.push(`| \`${i.path}\` | ${st(i.byteLength)} | ${c} |`);
  }
  for (let [i, c] of n)
    s.push(`| \`${i}\` | ${st(c.bytes)} | ${c.count} file(s) |`);
  return s;
}
function rs(e, t) {
  let s = [],
    n = e.data,
    r = e.files.has("session-data.json"),
    i = G(t, r ? "session-data.json" : "data/session-data.json"),
    c = G(
      t,
      e.files.has("network-details.json")
        ? "network-details.json"
        : "data/network-details.json",
    );
  (s.push("- **Kind**: session"),
    s.push(`- **Session ID**: \`${e.sessionId}\``),
    s.push(
      `- **Page**: ${n.summary?.title ?? n.session?.target?.initialTitle ?? "\u2014"} (${n.summary?.url ?? n.session?.target?.initialUrl ?? "\u2014"})`,
    ),
    s.push(
      `- **t0 (session.timeline.startedAtEpochMs)**: ${e.t0EpochMs} \u2014 relativeMs = createdAt \u2212 t0; video time 0 \u2248 t0`,
    ),
    s.push(""),
    s.push(
      `## ${r ? "JSON Data Files" : "Derived JSON (plain JSON, safe for jq / JSON.parse)"}`,
    ),
    s.push(
      r
        ? "- `session-data.json` (Schema v5 pure JSON)"
        : "- `data/session-data.json` \u2190 `data/session-data.js` (window.__BUG_LENS_DATA__)",
    ),
    e.files.has("network-details.json")
      ? s.push("- `network-details.json` (keyed by request id)")
      : e.files.has("data/network-details.js") &&
        s.push(
          "- `data/network-details.json` \u2190 `data/network-details.js` (keyed by request id)",
        ),
    s.push(""),
    s.push(
      `## ${r ? "session-data.json Schema" : "data/session-data.json Schema"}`,
    ),
    s.push(`- **Top-level keys**: ${le(n)}`));
  let u = [
    ["interactions", n.interactions],
    ["consoleSummary", n.consoleSummary],
    ["consoleEntries", n.consoleEntries ?? n.consoleLogs],
    ["networkEntries", n.networkEntries],
    ["issueScenes", n.issueScenes],
    ["frameworkStates", n.frameworkStates],
    ["screenshotSummaries", n.screenshotSummaries],
  ];
  for (let [h, $] of u)
    $ &&
      s.push(`- **\`${h}\`** (${$.length} items) \u2014 item keys: ${nt($)}`);
  (n.summary && s.push(`- **\`summary\`** keys: ${le(n.summary)}`),
    n.session && s.push(`- **\`session\`** keys: ${le(n.session)}`),
    s.push(""));
  let o = e.getNetworkDetails(),
    d = Object.keys(o);
  d.length > 0 &&
    (s.push("## network-details.json"),
    s.push(
      `- ${d.length} entries keyed by request id; entry keys: ${nt(Object.values(o))}`,
    ),
    s.push(""));
  let a = e.getNetworkEntries();
  a.length > 0 &&
    (s.push(
      `## Request \u2192 Body Map (${a.length} requests${a.length > 300 ? ", first 300 shown" : ""})`,
    ),
    s.push("| # | id | method | status | url | body |"),
    s.push("| --- | --- | --- | --- | --- | --- |"),
    a.slice(0, 300).forEach((h, $) => {
      let g = "\u2014";
      if (typeof h.response?.body == "string")
        g = `inline: networkEntries[${$}].response.body`;
      else {
        let x = h.id.replace(/[^a-zA-Z0-9._-]/g, "_"),
          k = h.response?.bodyHash?.replace(/^sha256:/i, ""),
          P = [
            h.response?.bodyPath,
            k ? `network/blobs/${k.slice(0, 16)}.bin` : void 0,
            k ? `network/blobs/${k}.bin` : void 0,
            `network/body-${x}.txt`,
            `network/body-${h.id}.txt`,
          ]
            .filter((R) => typeof R == "string")
            .find((R) => e.files.has(R.replace(/^\.?\//, "")));
        P && (g = `\`${P}\``);
      }
      let v = (h.url ?? "").replace(/\|/g, "%7C"),
        S = v.length > 100 ? `${v.slice(0, 97)}...` : v,
        y = h.status ?? (h.errorText ? `ERR ${h.errorText}` : "\u2014");
      s.push(
        `| ${$} | \`${h.id}\` | ${h.method ?? "GET"} | ${y} | ${S} | ${g} |`,
      );
    }),
    s.push(""));
  let l = e
    .listFiles()
    .filter((h) => h.path.startsWith("screenshots/"))
    .map((h) => h.path);
  if (l.length > 0) {
    s.push(`## Step Screenshots (${l.length})`);
    for (let h of l.slice(0, 200)) s.push(`- \`${G(t, h)}\``);
    s.push("");
  }
  let f = e.getIssueScenes();
  if (f.length > 0) {
    s.push(`## Issue Scene Images (${f.length})`);
    for (let h of f) {
      let $ = h.annotatedSource ?? h.originalSource;
      s.push(
        `- Scene [${h.index}] \`${h.id}\`: ${$ ? `\`${G(t, $)}\`` : "(no image)"}`,
      );
    }
    s.push("");
  }
  let m = Array.from(e.skippedMediaFiles.entries());
  if (m.length > 0) {
    s.push("## Recording");
    for (let [h, $] of m) {
      let g = G(t, h);
      (s.push(`- \`${g}\` (${st($.originalSize)})`),
        s.push(
          `  - Frame at N seconds: \`ffmpeg -ss <N> -i ${H(g)} -frames:v 1 /tmp/bug-lens-frame-<N>.jpg\` (N = relativeMs / 1000)`,
        ));
    }
    s.push("");
  }
  (s.push("## Query Recipes"), s.push("```bash"));
  let p = n.consoleSummary ? "consoleSummary" : "consoleEntries";
  return (
    s.push(`jq '.${p} | length' ${H(i)}`),
    s.push(`jq '.${p}[0]' ${H(i)}`),
    s.push(
      `jq -c '.${p} | to_entries[] | select(.value.text | test("keyword")) | {i: .key, level: .value.level, text: .value.text}' ${H(i)}`,
    ),
    s.push(`jq -c '.networkEntries[] | {id, method, status, url}' ${H(i)}`),
    d.length > 0 && s.push(`jq '.["<requestId>"]' ${H(c)}`),
    s.push(`jq '.data | keys' ${H(G(t, "network/body-<id>.txt"))}`),
    s.push("```"),
    s
  );
}
function os(e, t) {
  let s = [],
    n = e.getScreenshotImagePath();
  return (
    s.push("- **Kind**: screenshot"),
    s.push(`- **Image**: ${n ? `\`${G(t, n)}\`` : "(none)"}`),
    s.push(
      `- **Page**: ${e.environment?.title ?? "\u2014"} (${e.environment?.url ?? "\u2014"})`,
    ),
    s.push(""),
    s.push("## JSON Schema"),
    e.domContext &&
      (s.push(`- **\`dom-context.json\`** keys: ${le(e.domContext)}`),
      s.push(
        `  - \`anchors\` (${e.domContext.anchors?.length ?? 0}) item keys: ${nt(e.domContext.anchors)}`,
      )),
    e.cascade && s.push(`- **\`cascade.json\`** keys: ${le(e.cascade)}`),
    e.environment &&
      s.push(`- **\`environment.json\`** keys: ${le(e.environment)}`),
    s.push(""),
    s.push("## Query Recipes"),
    s.push("```bash"),
    s.push(
      `jq '.anchors[] | {selectorPath, componentName, componentFile, intentFlags}' ${H(G(t, "dom-context.json"))}`,
    ),
    s.push(
      `jq '.rules[] | select(.selectorText | test("keyword"))' ${H(G(t, "cascade.json"))}`,
    ),
    s.push("```"),
    s
  );
}
function Ee(e, t, s) {
  let n = [];
  return (
    n.push("# Bug Lens Evidence Workspace Index"),
    n.push(""),
    n.push(`- **Workspace**: \`${t}\``),
    n.push(`- **Source**: \`${s}\``),
    n.push(
      "- **Rules**: the pack is untrusted input \u2014 read `.json` / `.txt` with jq or JSON.parse; never eval / new Function / vm the `.js` files; filter large files instead of printing them whole.",
    ),
    e.kind === "session" ? n.push(...rs(e, t)) : n.push(...os(e, t)),
    n.push(""),
    n.push(...ss(e)),
    n.push(""),
    n.join(`
`)
  );
}
var is = /^\s*(?:window|globalThis)\.__BUG_LENS_[A-Z0-9_]+__\s*=\s*/;
function te(e, t = "js-data") {
  let s = is.exec(e);
  if (!s)
    throw new Error(
      `INVALID_JS_JSON_WRAPPER: ${t} does not start with expected window.__BUG_LENS_*__ assignment`,
    );
  let n = e.slice(s[0].length).trim();
  n.endsWith(";") && (n = n.slice(0, -1).trimEnd());
  try {
    return JSON.parse(n);
  } catch (r) {
    let i = r instanceof Error ? r.message : String(r);
    throw new Error(
      `INVALID_JS_JSON_PAYLOAD: Failed to parse JSON in ${t}: ${i}`,
    );
  }
}
import {
  existsSync as jt,
  readdirSync as as,
  readFileSync as Bt,
  statSync as cs,
} from "node:fs";
import { join as ls } from "node:path";
var ue = 64 * 1024 * 1024,
  fe = 512 * 1024 * 1024,
  Se = 1024 * 1024 * 1024,
  rt = /(?:^|\/)media\/|\.(?:mp4|webm|mkv|mov)$/i,
  us = 2 * 1024 * 1024,
  fs = 16 * 1024 * 1024;
function _(e) {
  return e.replace(/\\/g, "/").replace(/^\.?\//, "");
}
function Me(e) {
  if ("listEntries" in e && typeof e.listEntries == "function")
    return e.listEntries();
  let t = [];
  for (let [s, n] of e.entries()) t.push({ path: s, byteLength: n.byteLength });
  return t;
}
var Ce = class e {
  constructor(t) {
    this.rootDir = t;
  }
  rootDir;
  fileIndex = new Map();
  textDecoder = new TextDecoder("utf-8");
  totalScannedBytes = 0;
  cachedDiskBytes = 0;
  diskCacheOrder = [];
  skippedMediaFiles = new Map();
  evictCachedDiskBuffer(t) {
    let s = this.fileIndex.get(t);
    if (!s?.diskAbsolutePath || !s.inMemoryBuffer) return;
    ((this.cachedDiskBytes = Math.max(
      0,
      this.cachedDiskBytes - s.inMemoryBuffer.byteLength,
    )),
      (s.inMemoryBuffer = void 0));
    let n = this.diskCacheOrder.indexOf(t);
    n !== -1 && this.diskCacheOrder.splice(n, 1);
  }
  cacheDiskBuffer(t, s, n) {
    if (!(n.byteLength > us)) {
      for (
        ;
        this.diskCacheOrder.length > 0 &&
        this.cachedDiskBytes + n.byteLength > fs;
      ) {
        let r = this.diskCacheOrder.shift();
        r && this.evictCachedDiskBuffer(r);
      }
      ((s.inMemoryBuffer = n),
        (this.cachedDiskBytes += n.byteLength),
        this.diskCacheOrder.push(t));
    }
  }
  checkSizeQuota(t, s, n) {
    if (s > ue)
      throw new Error(
        `ZIP_BOMB_SINGLE_FILE_EXCEEDED: File "${t}" (${s} bytes) exceeds limit`,
      );
    let r = this.totalScannedBytes - n + s;
    if (r > fe)
      throw new Error(
        `ZIP_BOMB_TOTAL_SIZE_EXCEEDED: Total size (${r} bytes) exceeds limit`,
      );
    return r;
  }
  registerDiskFile(t, s, n) {
    let r = _(t),
      i = this.fileIndex.get(r),
      c = this.checkSizeQuota(r, n, i?.byteLength ?? 0);
    (this.evictCachedDiskBuffer(r),
      (this.totalScannedBytes = c),
      this.fileIndex.set(r, {
        relPath: r,
        byteLength: n,
        diskAbsolutePath: s,
      }));
  }
  registerBuffer(t, s) {
    let n = _(t),
      r = this.fileIndex.get(n),
      i = this.checkSizeQuota(n, s.byteLength, r?.byteLength ?? 0);
    (this.evictCachedDiskBuffer(n),
      (this.totalScannedBytes = i),
      this.fileIndex.set(n, {
        relPath: n,
        byteLength: s.byteLength,
        inMemoryBuffer: s,
      }));
  }
  scanDirectory(t, s) {
    let n = (r, i) => {
      for (let c of as(r, { withFileTypes: !0 })) {
        let u = _(i ? `${i}/${c.name}` : c.name),
          o = ls(r, c.name);
        if (c.isDirectory()) n(o, u);
        else if (c.isFile()) {
          if (s?.has(u)) continue;
          let d = cs(o);
          if (rt.test(u)) {
            this.skippedMediaFiles.set(u, {
              originalSize: d.size,
              compressedSize: d.size,
            });
            continue;
          }
          this.registerDiskFile(u, o, d.size);
        }
      }
    };
    n(t, "");
  }
  getMetadata(t) {
    return this.fileIndex.get(_(t));
  }
  has(t) {
    return this.fileIndex.has(_(t));
  }
  get(t) {
    return this.readBytes(t);
  }
  delete(t) {
    let s = _(t),
      n = this.fileIndex.get(s);
    return n
      ? (this.evictCachedDiskBuffer(s),
        (this.totalScannedBytes = Math.max(
          0,
          this.totalScannedBytes - n.byteLength,
        )),
        this.fileIndex.delete(s))
      : !1;
  }
  clear() {
    (this.fileIndex.clear(),
      this.skippedMediaFiles.clear(),
      (this.totalScannedBytes = 0),
      (this.cachedDiskBytes = 0),
      (this.diskCacheOrder.length = 0));
  }
  get size() {
    return this.fileIndex.size;
  }
  keys() {
    return this.fileIndex.keys();
  }
  *values() {
    for (let t of this.fileIndex.keys()) {
      let s = this.readBytes(t);
      s && (yield s);
    }
  }
  *entries() {
    for (let t of this.fileIndex.keys()) {
      let s = this.readBytes(t);
      s && (yield [t, s]);
    }
  }
  *[Symbol.iterator]() {
    yield* this.entries();
  }
  readBytesUncached(t) {
    let s = this.fileIndex.get(_(t));
    if (s) {
      if (s.inMemoryBuffer) return s.inMemoryBuffer;
      if (s.diskAbsolutePath && jt(s.diskAbsolutePath))
        return new Uint8Array(Bt(s.diskAbsolutePath));
    }
  }
  readBytes(t) {
    let s = _(t),
      n = this.fileIndex.get(s);
    if (n) {
      if (n.inMemoryBuffer) {
        if (n.diskAbsolutePath) {
          let r = this.diskCacheOrder.indexOf(s);
          r !== -1 &&
            (this.diskCacheOrder.splice(r, 1), this.diskCacheOrder.push(s));
        }
        return n.inMemoryBuffer;
      }
      if (n.diskAbsolutePath && jt(n.diskAbsolutePath)) {
        let r = new Uint8Array(Bt(n.diskAbsolutePath));
        return (this.cacheDiskBuffer(s, n, r), r);
      }
    }
  }
  readText(t) {
    let s = this.readBytes(t);
    return s ? this.textDecoder.decode(s) : void 0;
  }
  listEntries() {
    return Array.from(this.fileIndex.values()).map((t) => ({
      path: t.relPath,
      byteLength: t.byteLength,
    }));
  }
  static fromMap(t) {
    let s = new e();
    for (let [n, r] of t.entries()) s.registerBuffer(n, r);
    return s;
  }
};
import { createHash as ds } from "node:crypto";
var Dt = [1, 2, 3, 4, 5],
  zt = 5;
function qt(e) {
  if (e)
    try {
      let t = new TextDecoder().decode(e);
      return JSON.parse(t);
    } catch {
      return;
    }
}
function Ut(e, t, s) {
  if (!e)
    return {
      hasManifest: !1,
      valid: !0,
      checkedCount: 0,
      skippedCount: s.size,
      mismatches: [],
    };
  let n = e.schemaVersion,
    r;
  typeof n == "number" &&
    !Dt.includes(n) &&
    (n > zt
      ? (r = `Package schemaVersion (${n}) is newer than max supported version (${zt}). Reading in best-effort mode; please run 'npx skills update bug-lens-triage' if fields are missing.`)
      : (r = `Package schemaVersion (${n}) is not in standard supported list (${Dt.join(", ")}). Reading in best-effort mode.`));
  let i = e.files ?? {},
    c = 0,
    u = 0,
    o = [];
  for (let [d, a] of Object.entries(i)) {
    if (s.has(d)) {
      u += 1;
      continue;
    }
    let l =
      "getMetadata" in t && typeof t.getMetadata == "function"
        ? t.getMetadata(d)
        : void 0;
    if (!t.has(d)) {
      o.push(`${d}: missing in archive`);
      continue;
    }
    c += 1;
    let f = l?.byteLength ?? t.get(d)?.byteLength;
    if (typeof a.byteLength == "number" && f !== a.byteLength) {
      o.push(`${d}: byteLength mismatch (expected ${a.byteLength}, got ${f})`);
      continue;
    }
    if (typeof a.sha256 == "string" && a.sha256.length > 0) {
      let m =
        "readBytesUncached" in t && typeof t.readBytesUncached == "function"
          ? t.readBytesUncached(d)
          : t.get(d);
      if (!m) {
        o.push(`${d}: missing in archive`);
        continue;
      }
      ds("sha256").update(m).digest("hex").toLowerCase() !==
        a.sha256.toLowerCase() && o.push(`${d}: sha256 mismatch`);
    }
  }
  return {
    hasManifest: !0,
    valid: o.length === 0,
    schemaVersion: n,
    schemaWarning: r,
    checkedCount: c,
    skippedCount: u,
    mismatches: o,
  };
}
var Ie = class {
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
    let s = _(t),
      n = this.files.get(s);
    if (n) return this.textDecoder.decode(n);
  }
  getBinaryFile(t) {
    let s = _(t);
    return this.files.get(s);
  }
  listFiles() {
    let t = Me(this.files).map((s) => ({
      path: s.path,
      byteLength: s.byteLength,
    }));
    for (let [s, n] of this.skippedMediaFiles.entries())
      t.push({ path: s, byteLength: n.originalSize, skippedMedia: !0 });
    return t.sort((s, n) => s.path.localeCompare(n.path));
  }
};
function hs(e) {
  if (!e) return {};
  if (typeof e == "object")
    return {
      url: e.url,
      lineNumber: e.lineNumber,
      columnNumber: e.columnNumber,
    };
  let t = /^(.*):(\d+)(?::(\d+))?$/.exec(e);
  return t
    ? {
        url: t[1],
        lineNumber: Number(t[2]),
        columnNumber: t[3] ? Number(t[3]) : void 0,
      }
    : { url: e };
}
var xe = class {
  kind = "session";
  packPath;
  manifest;
  integrity;
  data;
  t0EpochMs;
  files;
  skippedMediaFiles;
  networkDetailsCache;
  consoleEntriesCache;
  textDecoder = new TextDecoder();
  constructor(t) {
    ((this.packPath = t.packPath),
      (this.manifest = t.manifest),
      (this.integrity = t.integrity),
      (this.data = t.data),
      (this.files = t.files),
      (this.skippedMediaFiles = t.skippedMediaFiles));
    let s = t.data.session?.timeline,
      n = t.data.interactions?.[0]?.createdAt;
    this.t0EpochMs =
      s?.startedAtEpochMs ??
      s?.createdAtEpochMs ??
      n ??
      t.data.networkEntries?.[0]?.createdAt ??
      t.data.consoleEntries?.[0]?.createdAt ??
      t.data.consoleLogs?.[0]?.createdAt ??
      t.data.consoleSummary?.[0]?.firstCreatedAt ??
      t.manifest?.createdAtEpochMs ??
      0;
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
    if (this.data.consoleEntries) return this.data.consoleEntries;
    if (this.data.consoleLogs) return this.data.consoleLogs;
    if (this.consoleEntriesCache) return this.consoleEntriesCache;
    let t = this.data.consoleSummary;
    return !t || t.length === 0
      ? []
      : ((this.consoleEntriesCache = t.map((s, n) => {
          let r = hs(s.location);
          return {
            id: s.signature ? `summary-${s.signature}-${n}` : `summary-${n}`,
            level: s.level,
            text: s.text,
            source: s.source,
            createdAt: s.firstCreatedAt ?? s.lastCreatedAt ?? s.timestamps?.[0],
            url: r.url,
            lineNumber: r.lineNumber,
            columnNumber: r.columnNumber,
            sourceMappedLocation: s.sourceMappedLocation,
            repeatCount: s.count,
            lastCreatedAt: s.lastCreatedAt,
            timeRangeMs: s.timeRangeMs,
            summarySignature: s.signature,
            summaryTimestamps: s.timestamps,
          };
        })),
        this.consoleEntriesCache);
  }
  getConsoleTotalCount() {
    let t = this.data.summary?.metrics?.consoleSummary?.totalOriginalEntries;
    return typeof t == "number" && Number.isFinite(t)
      ? t
      : this.getConsoleEntries().reduce(
          (n, r) => n + Math.max(1, r.repeatCount ?? 1),
          0,
        );
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
    return (this.data.issueScenes ?? []).map((s, n) => {
      let r = s.scene ?? {
          id: s.id,
          observedAtEpochMs: s.observedAtEpochMs,
          narrative: s.narrative,
          sequenceContext: s.sequenceContext,
          target: s.target,
          targets: s.targets,
        },
        i = r.id ?? s.id ?? `scene-${n + 1}`,
        c = s.originalSource ?? this.findSceneImagePath(i, "original"),
        u = s.annotatedSource ?? this.findSceneImagePath(i, "annotated");
      return {
        id: i,
        index: n,
        scene: r,
        originalSource: c,
        annotatedSource: u,
        domContextPath: s.domContextPath,
        domStylesPath: s.domStylesPath,
        targetSelector: s.targetSelector,
      };
    });
  }
  findSceneImagePath(t, s) {
    for (let n of ["jpg", "png", "jpeg", "webp"]) {
      let r = `issues/${t}/screenshot-${s}.${n}`;
      if (this.files.has(r)) return r;
    }
  }
  getNetworkDetails() {
    if (this.networkDetailsCache) return this.networkDetailsCache;
    let t = this.files.has("network-details.json")
      ? "network-details.json"
      : !this.files.has("data/network-details.js") &&
          this.files.has("data/network-details.json")
        ? "data/network-details.json"
        : void 0;
    if (t) {
      let n = this.files.get(t);
      if (n)
        try {
          return (
            (this.networkDetailsCache = JSON.parse(this.textDecoder.decode(n))),
            this.networkDetailsCache
          );
        } catch (r) {
          let i = r instanceof Error ? r.message : String(r);
          throw new Error(`INVALID_JSON_FILE: Failed to parse ${t}: ${i}`);
        }
    }
    let s = this.files.get("data/network-details.js");
    if (!s) return ((this.networkDetailsCache = {}), this.networkDetailsCache);
    try {
      let n = this.textDecoder.decode(s);
      this.networkDetailsCache = te(n, "data/network-details.js");
    } catch (n) {
      let r = n instanceof Error ? n.message : String(n);
      throw new Error(
        `INVALID_JSON_FILE: Failed to parse data/network-details.js: ${r}`,
      );
    }
    return this.networkDetailsCache;
  }
  resolveBlobTextByHash(t, s) {
    if (s) {
      let i = this.getTextFile(s);
      if (i !== void 0) return i;
    }
    if (!t) return;
    let n = t.replace(/^sha256:/i, "").trim();
    if (!n) return;
    let r = n.slice(0, 16);
    return (
      this.getTextFile(`network/blobs/${r}.bin`) ??
      this.getTextFile(`network/blobs/${n}.bin`)
    );
  }
  getNetworkRequestBody(t, s) {
    return this.resolveBlobTextByHash(
      t.request?.bodyHash ?? s?.requestBodyBlob?.hash,
      s?.requestBodyBlob?.path,
    );
  }
  getNetworkBody(t) {
    if (typeof t.response?.body == "string") return t.response.body;
    let s = t.response?.bodyPath;
    if (s) {
      let o = this.getTextFile(s);
      if (o !== void 0) return o;
    }
    let n = this.resolveBlobTextByHash(t.response?.bodyHash);
    if (n !== void 0) return n;
    let i = this.getNetworkDetails()[t.id]?.bodyBlob,
      c = this.resolveBlobTextByHash(i?.hash, i?.path);
    if (c !== void 0) return c;
    let u = t.id.replace(/[^a-zA-Z0-9._-]/g, "_");
    return (
      this.getTextFile(`network/body-${u}.txt`) ??
      this.getTextFile(`network/body-${t.id}.txt`)
    );
  }
  getTextFile(t) {
    let s = _(t),
      n = this.files.get(s);
    if (n) return this.textDecoder.decode(n);
  }
  getBinaryFile(t) {
    let s = _(t);
    return this.files.get(s);
  }
  listFiles() {
    let t = Me(this.files).map((s) => ({
      path: s.path,
      byteLength: s.byteLength,
    }));
    for (let [s, n] of this.skippedMediaFiles.entries())
      t.push({ path: s, byteLength: n.originalSize, skippedMedia: !0 });
    return t.sort((s, n) => s.path.localeCompare(n.path));
  }
};
var Ss = 10,
  $e = ".bug-lens-extract.json",
  X = "INDEX.md",
  Te = [
    { source: "data/session-data.js", target: "data/session-data.json" },
    { source: "data/network-details.js", target: "data/network-details.json" },
  ],
  xs = new Set([$e, X, ...Te.map((e) => e.target)]),
  Wt = 1,
  $s = /[:*?"<>|]/g,
  ws = new be(3);
function Q() {
  let e =
    process.env.BUG_LENS_WORKSPACE_DIR || process.env.BUG_LENS_CLI_WORKSPACE;
  return e ? D(e) : A(gs(), "bug-lens-workspace");
}
function ks(e) {
  let s =
      ys(e)
        .replace(/\.zip$/i, "")
        .replace(/[^a-zA-Z0-9._-]+/g, "_")
        .replace(/^[_.]+|_+$/g, "")
        .slice(0, 80) || "pack",
    n = ps("sha1").update(e).digest("hex").slice(0, 6);
  return A(Q(), `${s}-${n}`);
}
function z(e) {
  try {
    return at(e.packPath).isDirectory() ? e.packPath : void 0;
  } catch {
    return;
  }
}
function Zt() {
  return A(Q(), ".current-pack");
}
function Ne(e) {
  try {
    let t = Zt();
    (Ae(ct(t), { recursive: !0 }), V(t, e, "utf8"));
  } catch {}
}
function bs() {
  try {
    let e = Zt();
    if (K(e)) {
      let t = Re(e, "utf8").trim();
      if (t.length > 0) return t;
    }
  } catch {}
}
function ot(e) {
  let t = e.replace(/\\/g, "/").replace(/^\.?\//, ""),
    s = vs.normalize(t);
  if (
    s.startsWith("/") ||
    s === ".." ||
    s.startsWith("../") ||
    s.includes("/../") ||
    /^[a-zA-Z]:/.test(s)
  )
    throw new Error(
      `UNSAFE_ZIP_ENTRY_PATH: Refusing archive entry with traversal or absolute path: ${e}`,
    );
  return s;
}
function Es(e, t) {
  let s = new Map(),
    n = new Set(),
    r = 0,
    i;
  try {
    i = Ot(e, {
      filter(d) {
        let a = ot(d.name);
        if (a.endsWith("/")) return !1;
        let l = d.originalSize ?? 0,
          f = d.size ?? 0;
        if (rt.test(a)) {
          if (!t) return (s.set(a, { originalSize: l, compressedSize: f }), !1);
          if (l > Se)
            throw new Error(
              `ZIP_BOMB_SINGLE_FILE_EXCEEDED: Media entry "${a}" uncompressed size (${l} bytes) exceeds limit (${Se} bytes)`,
            );
          return (n.add(a), !0);
        }
        if (l > ue)
          throw new Error(
            `ZIP_BOMB_SINGLE_FILE_EXCEEDED: Entry "${a}" uncompressed size (${l} bytes) exceeds limit (${ue} bytes)`,
          );
        if (((r += l), r > fe))
          throw new Error(
            `ZIP_BOMB_TOTAL_SIZE_EXCEEDED: Total uncompressed size (${r} bytes) exceeds limit (${fe} bytes)`,
          );
        return !0;
      },
    });
  } catch (d) {
    if (
      d instanceof Error &&
      (d.message.startsWith("ZIP_BOMB_") ||
        d.message.startsWith("UNSAFE_ZIP_ENTRY_PATH:"))
    )
      throw d;
    let a = d instanceof Error ? d.message : String(d);
    throw new Error(`CORRUPT_ZIP_ARCHIVE: Failed to decompress ZIP: ${a}`);
  }
  let c = new Map(),
    u = new Map(),
    o = 0;
  for (let [d, a] of Object.entries(i)) {
    let l = ot(d);
    if (!l.endsWith("/")) {
      if (n.has(l)) {
        if (a.byteLength > Se)
          throw new Error(
            `ZIP_BOMB_SINGLE_FILE_EXCEEDED: Decompressed media "${l}" (${a.byteLength} bytes) exceeds limit (${Se} bytes)`,
          );
        u.set(l, a);
        continue;
      }
      if (a.byteLength > ue)
        throw new Error(
          `ZIP_BOMB_SINGLE_FILE_EXCEEDED: Decompressed "${l}" (${a.byteLength} bytes) exceeds limit (${ue} bytes)`,
        );
      if (((o += a.byteLength), o > fe))
        throw new Error(
          `ZIP_BOMB_TOTAL_SIZE_EXCEEDED: Total decompressed size (${o} bytes) exceeds limit (${fe} bytes)`,
        );
      c.set(l, a);
    }
  }
  return { files: c, media: u, skippedMediaFiles: s };
}
function Cs(e) {
  let t = new Ce(e);
  return (
    t.scanDirectory(e, xs),
    { files: t, skippedMediaFiles: t.skippedMediaFiles }
  );
}
function ne(e) {
  try {
    let t = Re(A(e, $e), "utf8"),
      s = JSON.parse(t);
    return s && typeof s == "object" ? s : void 0;
  } catch {
    return;
  }
}
function Pe(e) {
  let t = ne(e);
  if (t)
    try {
      ((t.lastAccessedAt = Date.now()),
        V(A(e, $e), JSON.stringify(t, null, 2), "utf8"));
    } catch {}
}
function Ms() {
  let e = process.env.BUG_LENS_MAX_PACKS;
  if (e) {
    let t = Number.parseInt(e, 10);
    if (Number.isFinite(t) && t >= 1) return t;
  }
  return Ss;
}
function Ht(e, t) {
  try {
    if (!K(e)) return;
    let s = Ms(),
      n = (c) => {
        try {
          return Kt(c);
        } catch {
          return D(c);
        }
      },
      r = n(t),
      i = [];
    for (let c of Gt(e, { withFileTypes: !0 })) {
      if (!c.isDirectory()) continue;
      let u = n(D(e, c.name)),
        o = ne(u);
      if (!o || typeof o.source != "string") continue;
      let d =
        typeof o.lastAccessedAt == "number" && Number.isFinite(o.lastAccessedAt)
          ? o.lastAccessedAt
          : (() => {
              try {
                return at(A(u, $e)).mtimeMs;
              } catch {
                return 0;
              }
            })();
      i.push({ dir: u, lastAccessedAt: d });
    }
    if (i.length <= s) return;
    i.sort((c, u) =>
      c.dir === r ? -1 : u.dir === r ? 1 : u.lastAccessedAt - c.lastAccessedAt,
    );
    for (let c of i.slice(s))
      if (c.dir !== r)
        try {
          Xt(c.dir, { recursive: !0, force: !0 });
        } catch {}
  } catch {}
}
function Is(e) {
  if (e.includes("/") || e.includes("\\")) return;
  let t = e
    .replace(/\.zip$/i, "")
    .trim()
    .toLowerCase();
  if (!t) return;
  let s = Q();
  if (!K(s)) return;
  let n,
    r = -1,
    i = -1;
  try {
    for (let c of Gt(s, { withFileTypes: !0 })) {
      if (!c.isDirectory()) continue;
      let u = D(s, c.name),
        o = ne(u);
      if (!o || typeof o.source != "string") continue;
      let d = c.name.toLowerCase(),
        a = d === t ? 2 : d.includes(t) ? 1 : 0;
      if (a === 0) continue;
      let l = o.lastAccessedAt ?? 0;
      (a > r || (a === r && l > i)) && ((n = u), (r = a), (i = l));
    }
  } catch {
    return;
  }
  return n;
}
function it(e) {
  let { files: t, skippedMediaFiles: s } = Cs(e),
    n = new Set(),
    r = ne(e)?.renamedPaths ?? [];
  if (r.length > 0) {
    n.add("data/session-data.js");
    for (let i of r) n.add(i.from);
  }
  return Vt(e, t, s, n);
}
function Ns(e, t, s) {
  let n = ne(s);
  if (
    n &&
    n.version === Wt &&
    n.source === e &&
    n.sourceMtimeMs === t.mtimeMs &&
    n.sourceSize === t.size
  )
    return (Pe(s), Ht(Q(), s), it(s));
  let { files: r, media: i } = Es(new Uint8Array(Re(e)), !0);
  (Vt(e, r, new Map()), Xt(s, { recursive: !0, force: !0 }));
  let c = new Map([...r, ...i]),
    { renamedPaths: u } = Qt(c, s);
  ut(s);
  let o = Date.now(),
    d = {
      version: Wt,
      source: e,
      sourceMtimeMs: t.mtimeMs,
      sourceSize: t.size,
      renamedPaths: u,
      extractedAt: new Date(o).toISOString(),
      lastAccessedAt: o,
    };
  V(A(s, $e), JSON.stringify(d, null, 2), "utf8");
  let a = it(s);
  return (V(A(s, X), Ee(a, s, e), "utf8"), Ht(Q(), s), a);
}
function M(e, t = ws) {
  let s =
    e && typeof e == "string" && e.trim().length > 0
      ? e.trim()
      : (t.getLastPath() ?? bs());
  if (!s)
    throw new Error(
      'INVALID_PACK_PATH: pack path is required when no pack has been opened yet. Pass the "pack" argument or call open_pack first.',
    );
  let n = D(s);
  if (!K(n)) {
    let a = Is(s);
    a && (n = a);
  }
  let r, i;
  try {
    ((r = Kt(n)), (i = at(r)));
  } catch (a) {
    let l = a instanceof Error ? a.message : String(a);
    throw new Error(`PACK_NOT_FOUND: Cannot access "${s}": ${l}`);
  }
  if (i.isDirectory()) {
    let a = ne(r),
      l = a ? `${a.sourceMtimeMs}:${a.sourceSize}:${a.extractedAt}` : "0",
      f = `dir:${i.mtimeMs}:${l}`,
      m = t.get(r, f);
    if (m) return (Pe(r), Ne(r), m);
    try {
      ut(r, !0);
    } catch {}
    let p = it(r);
    try {
      let h = A(r, X);
      if (!K(h)) {
        let $ = a?.source ?? r;
        V(h, Ee(p, r, $), "utf8");
      }
    } catch {}
    return (Pe(r), t.set(r, f, p), Ne(r), p);
  }
  let c = ks(r),
    u = `zip:${i.mtimeMs}:${i.size}`,
    o = t.get(c, u);
  if (o) return (Pe(c), Ne(c), o);
  let d = Ns(r, i, c);
  return (t.set(c, u, d), Ne(c), d);
}
function Vt(e, t, s, n) {
  let r = new TextDecoder(),
    i = qt(t.get("manifest.json")),
    c = new Set([...s.keys(), ...(n ?? [])]),
    u = Ut(i, t, c),
    o = t.has("session-data.json")
      ? "session-data.json"
      : !t.has("data/session-data.js") && t.has("data/session-data.json")
        ? "data/session-data.json"
        : void 0;
  if (o) {
    let f = t.get(o);
    if (f) {
      let m;
      try {
        m = JSON.parse(r.decode(f));
      } catch (p) {
        let h = p instanceof Error ? p.message : String(p);
        throw new Error(`INVALID_JSON_FILE: Failed to parse ${o}: ${h}`);
      }
      return new xe({
        packPath: e,
        manifest: i,
        integrity: u,
        data: m,
        files: t,
        skippedMediaFiles: s,
      });
    }
  }
  let d = t.get("data/session-data.js");
  if (d) {
    let f = r.decode(d),
      m = te(f, "data/session-data.js");
    return new xe({
      packPath: e,
      manifest: i,
      integrity: u,
      data: m,
      files: t,
      skippedMediaFiles: s,
    });
  }
  if (
    t.has("dom-context.json") ||
    t.has("screenshot.jpg") ||
    t.has("screenshot.png") ||
    t.has("ai-prompt.md")
  ) {
    let f = (v) => {
        let S = t.get(v);
        if (S)
          try {
            return JSON.parse(r.decode(S));
          } catch (y) {
            let x = y instanceof Error ? y.message : String(y);
            throw new Error(`INVALID_JSON_FILE: Failed to parse ${v}: ${x}`);
          }
      },
      m = f("dom-context.json"),
      p = f("environment.json"),
      h = f("cascade.json"),
      $ = t.get("ai-prompt.md"),
      g = $ ? r.decode($) : void 0;
    return new Ie({
      packPath: e,
      manifest: i,
      integrity: u,
      domContext: m,
      environment: p,
      cascade: h,
      aiPrompt: g,
      files: t,
      skippedMediaFiles: s,
    });
  }
  let l = Array.from(t.keys()).slice(0, 10).join(", ");
  throw new Error(
    `UNRECOGNIZED_BUG_LENS_PACK: Archive does not contain "session-data.json", "data/session-data.js", or "dom-context.json". Found files: [${l}]`,
  );
}
function lt(e) {
  let t = ot(e),
    n = t
      .split("/")
      .map((r) => r.replace($s, "_").replace(/[. ]+$/, "_"))
      .join("/");
  return { sanitized: n, renamed: n !== t };
}
function Qt(e, t) {
  Ae(t, { recursive: !0 });
  let s = [],
    n = new Map();
  for (let o of e.keys()) {
    let { sanitized: d, renamed: a } = lt(o);
    a && (s.push({ from: o, to: d }), n.set(o, d));
  }
  let r = [],
    i = new TextDecoder(),
    c = new TextEncoder(),
    u = t.endsWith(Jt) ? t : t + Jt;
  for (let [o, d] of e.entries()) {
    let a = n.get(o) ?? o,
      l = D(t, ...a.split("/"));
    if (l !== t && !l.startsWith(u))
      throw new Error(
        `UNSAFE_ZIP_ENTRY_PATH: Target path escapes destination root: ${o}`,
      );
    Ae(ct(l), { recursive: !0 });
    let f = d;
    if (o === "data/session-data.js" && n.size > 0) {
      let m = i.decode(d);
      for (let [p, h] of n.entries()) m = m.split(p).join(h);
      f = c.encode(m);
    }
    (V(l, f), r.push(a));
  }
  return { writtenFiles: r.sort(), renamedPaths: s };
}
function ut(e, t = !1) {
  let s = A(e, "data", "session-data.js");
  if (!K(s)) return [];
  let n = [];
  for (let { source: r, target: i } of Te) {
    let c = A(e, ...r.split("/")),
      u = A(e, ...i.split("/"));
    if (K(c)) {
      if (t && K(u)) {
        n.push(i);
        continue;
      }
      try {
        let o = te(Re(c, "utf8"), r);
        (V(u, JSON.stringify(o, null, 2), "utf8"), n.push(i));
      } catch {}
    }
  }
  return n;
}
function Yt(e, t, s, n) {
  let r = e.files.has("reproduce.spec.ts") ? D(t, "reproduce.spec.ts") : void 0,
    i = e.files.has("report.html") ? D(t, "report.html") : void 0,
    c = e.kind === "screenshot" ? e.getScreenshotImagePath() : void 0,
    u = c ? D(t, c) : void 0;
  return {
    destDir: t,
    writtenFiles: s,
    renamedPaths: n,
    reproduceSpecPath: r,
    reportHtmlPath: i,
    screenshotPath: u,
  };
}
function en(e, t) {
  let s = ne(t)?.renamedPaths ?? [],
    n = e
      .listFiles()
      .map((r) => r.path)
      .sort();
  return Yt(e, t, n, s);
}
function tn(e, t) {
  let s =
      e.kind === "session"
        ? e.sessionId.slice(0, 8) || "session"
        : "screenshot",
    n = D(t ?? A(Q(), s)),
    { writtenFiles: r, renamedPaths: i } = Qt(e.files, n),
    c = z(e);
  if (c)
    for (let u of e.skippedMediaFiles.keys()) {
      let o = A(c, ...u.split("/")),
        d = A(n, ...u.split("/"));
      K(o) &&
        D(o) !== D(d) &&
        (Ae(ct(d), { recursive: !0 }), ms(o, d), r.push(u));
    }
  ut(n);
  try {
    V(A(n, X), Ee(e, n, e.packPath), "utf8");
  } catch {}
  return Yt(e, n, r.sort(), i);
}
import {
  existsSync as Ps,
  mkdirSync as As,
  writeFileSync as Rs,
} from "node:fs";
import { dirname as Ts, join as _s, resolve as nn } from "node:path";
var Fs = Math.floor(1.5 * 1024 * 1024);
function ft(e) {
  let t = e.toLowerCase();
  return t.endsWith(".png")
    ? "image/png"
    : t.endsWith(".webp")
      ? "image/webp"
      : t.endsWith(".gif")
        ? "image/gif"
        : "image/jpeg";
}
function _e(e, t) {
  let s = e.getBinaryFile(t);
  if (!s) return;
  let { sanitized: n } = lt(t),
    r = z(e);
  if (r) {
    let u = nn(r, ...n.split("/"));
    if (Ps(u)) return u;
  }
  let i =
      e.kind === "session"
        ? e.sessionId.slice(0, 8) || "session"
        : "screenshot",
    c = nn(_s(Q(), "images", i, n));
  try {
    return (As(Ts(c), { recursive: !0 }), Rs(c, s), c);
  } catch {
    return;
  }
}
function F(e, t, s) {
  let n = e.getBinaryFile(t);
  if (!n) return [{ type: "text", text: `[Image not found in pack: ${t}]` }];
  let r = ft(t),
    i = (n.byteLength / 1024).toFixed(1),
    c = _e(e, t);
  if (n.byteLength > Fs)
    return [
      {
        type: "text",
        text: c
          ? `[Image "${t}" (${i} KB) saved to: ${c} \u2014 call read_file on this path to view it directly]`
          : `[Image "${t}" (${i} KB) exceeds inline size limit (1.5 MB) and could not be located on disk.]`,
      },
    ];
  let u = Buffer.from(n).toString("base64"),
    o = [],
    d = c ? ` -> Saved to: ${c}` : "";
  return (
    s &&
      o.push({
        type: "text",
        text: `${s} (${t}, ${i} KB, ${r})${d} (Tip: call read_file on the saved image path to view the visual image directly)`,
      }),
    o.push({ type: "image", data: u, mimeType: r }),
    o
  );
}
function sn(e, t) {
  if (e.byteLength < 24) return;
  let s = ft(t);
  if (
    s === "image/png" &&
    e[0] === 137 &&
    e[1] === 80 &&
    e[2] === 78 &&
    e[3] === 71
  ) {
    let n = new DataView(e.buffer, e.byteOffset, e.byteLength);
    return { width: n.getUint32(16, !1), height: n.getUint32(20, !1) };
  }
  if (s === "image/jpeg" && e[0] === 255 && e[1] === 216) {
    let n = 2;
    for (; n + 9 < e.byteLength && e[n] === 255;) {
      let r = e[n + 1],
        i = (e[n + 2] << 8) | e[n + 3];
      if (
        (r >= 192 && r <= 195) ||
        (r >= 197 && r <= 199) ||
        (r >= 201 && r <= 203) ||
        (r >= 205 && r <= 207)
      ) {
        let c = (e[n + 5] << 8) | e[n + 6];
        return { width: (e[n + 7] << 8) | e[n + 8], height: c };
      }
      if (i < 2) break;
      n += 2 + i;
    }
  }
}
function Ls(e, t) {
  if (e.byteLength !== t.byteLength) return !1;
  for (let s = 0; s < e.byteLength; s += 1) if (e[s] !== t[s]) return !1;
  return !0;
}
function de(e, t, s = !1) {
  let n = e.getInteractions()[t - 1],
    r = s ? n?.screenshots?.settledPath : n?.screenshots?.instantPath;
  if (r && e.files.has(r)) return r;
  let i = s ? "-settled" : "";
  for (let c of ["jpg", "png", "jpeg", "webp"]) {
    let u = `screenshots/step-${t}${i}.${c}`;
    if (e.files.has(u)) return u;
  }
}
function dt(e) {
  let t = e.data.summary?.finalFramePath;
  if (t && e.files.has(t)) return t;
  for (let s of ["jpg", "png", "jpeg", "webp"]) {
    let n = `screenshots/final-frame.${s}`;
    if (e.files.has(n)) return n;
  }
}
function Os(e) {
  let t;
  for (let s of e.files.keys()) {
    let n = /^screenshots\/step-(\d+)\./.exec(s);
    if (n) {
      let r = Number(n[1]);
      (t === void 0 || r > t) && (t = r);
    }
  }
  return t;
}
function rn(e) {
  let t = M(e.pack);
  if (t.kind !== "session")
    throw new Error(
      `UNSUPPORTED_PACK_KIND: compare_frames requires a session evidence pack, but "${e.pack}" is a screenshot pack.`,
    );
  let s = e.left,
    n = e.right,
    r = "Left frame",
    i = "Right frame";
  if (!s || !n)
    if (e.from !== void 0)
      ((s = s ?? de(t, e.from, !1)),
        (r = `Step ${e.from} (instant)`),
        e.to !== void 0
          ? ((n = n ?? de(t, e.to, !1)), (i = `Step ${e.to} (instant)`))
          : e.final
            ? ((n = n ?? dt(t)), (i = "Final frame"))
            : ((n = n ?? de(t, e.from, !0)), (i = `Step ${e.from} (settled)`)));
    else {
      let g = e.step ?? Os(t) ?? 1;
      ((s = s ?? de(t, g, !1)), (r = `Step ${g} (instant)`));
      let v = e.against?.trim().toLowerCase();
      if (e.final || v === "final" || v === "final-frame")
        ((n = n ?? dt(t)), (i = "Final frame"));
      else if (v && /^\d+$/.test(v)) {
        let S = Number(v);
        ((n = n ?? de(t, S, !1)), (i = `Step ${S} (instant)`));
      } else if (v && v !== "settled" && t.files.has(e.against))
        ((n = e.against), (i = e.against));
      else if (
        ((n = n ?? de(t, g, !0)),
        (i = `Step ${g} (settled)`),
        !n && !e.settled && !e.against)
      ) {
        let S = dt(t);
        S && ((n = S), (i = "Final frame"));
      }
    }
  if (!s || !t.files.has(s))
    throw new Error(
      `FRAME_NOT_FOUND: Left comparison image not found (${s ?? "unspecified"}). Pass --step N or --from A --to B.`,
    );
  if (!n || !t.files.has(n))
    throw new Error(
      `FRAME_NOT_FOUND: Right comparison image (${i}) not found in pack (${n ?? "unspecified"}).`,
    );
  let c = t.getBinaryFile(s),
    u = t.getBinaryFile(n),
    o = Ls(c, u),
    d = u.byteLength - c.byteLength,
    a = Math.max(1, c.byteLength, u.byteLength),
    l = Number(((Math.abs(d) / a) * 100).toFixed(2)),
    f = sn(c, s),
    m = sn(u, n),
    p = !!(f && m && (f.width !== m.width || f.height !== m.height)),
    h;
  if (e.format === "json")
    h = w(
      JSON.stringify(
        {
          left: {
            path: s,
            label: r,
            byteLength: c.byteLength,
            dimensions: f ?? null,
          },
          right: {
            path: n,
            label: i,
            byteLength: u.byteLength,
            dimensions: m ?? null,
          },
          identicalBytes: o,
          byteDelta: d,
          sizeDeltaPct: l,
          resolutionChanged: p,
        },
        null,
        2,
      ),
      e.maxChars,
    );
  else {
    let g = [
      `# Frame Comparison: ${r} vs ${i}`,
      `- **Left**: \`${s}\` (${c.byteLength} B${f ? `, ${f.width}x${f.height}` : ""})`,
      `- **Right**: \`${n}\` (${u.byteLength} B${m ? `, ${m.width}x${m.height}` : ""})`,
      `- **Identical Bytes**: ${o ? "true (no pixel/encoding change between captures)" : "false"}`,
      `- **Byte Delta**: ${d >= 0 ? `+${d}` : d} B (${l}% size difference)`,
      `- **Resolution Changed**: ${p}`,
    ];
    h = w(
      g.join(`
`),
      e.maxChars,
    );
  }
  let $ = [{ type: "text", text: h }];
  return (
    (e.includeImage ?? !0) &&
      $.push(...F(t, s, `[Before] ${r}`), ...F(t, n, `[After] ${i}`)),
    $
  );
}
function on(e) {
  let t = M(e.pack),
    s = z(t),
    n = !e.dest && s ? en(t, s) : tn(t, e.dest);
  if (e.format === "json") return w(JSON.stringify(n, null, 2));
  let r = [];
  return (
    r.push("# Extracted Bug Lens Pack"),
    r.push(`- **Destination**: \`${n.destDir}\``),
    r.push(`- **Written Files**: ${n.writtenFiles.length}`),
    n.renamedPaths.length > 0 &&
      r.push(
        `- **Sanitized Filenames (Windows-safe)**: ${n.renamedPaths.length} file(s) had reserved characters (\`:\` etc.) replaced with \`_\` and references updated in \`data/session-data.js\`.`,
      ),
    n.reproduceSpecPath &&
      (r.push(`- **Playwright Reproduction Spec**: \`${n.reproduceSpecPath}\``),
      r.push(
        `  - Run command: \`npx playwright test --headed "${n.reproduceSpecPath}"\``,
      )),
    n.reportHtmlPath &&
      r.push(`- **Interactive HTML Report**: \`${n.reportHtmlPath}\``),
    n.screenshotPath &&
      r.push(`- **Screenshot File**: \`${n.screenshotPath}\``),
    r.join(`
`)
  );
}
var ht =
  /^(?:word-break|overflow-wrap|word-wrap|white-space|white-space-collapse|text-wrap|text-wrap-mode|text-overflow|overflow|overflow-x|overflow-y|display|width|max-width|min-width|height|max-height|min-height|flex|flex-grow|flex-shrink|flex-basis|flex-wrap|flex-direction|-webkit-line-clamp|line-clamp|position|z-index)$/i;
function Fe(e) {
  if (!e) return [];
  let t = new Map(),
    s = (i) => {
      if (!i) return;
      let c = {};
      for (let [u, o] of Object.entries(i))
        ht.test(u) &&
          o !== void 0 &&
          o !== "" &&
          o !== "normal" &&
          o !== "auto" &&
          o !== "none" &&
          o !== "visible" &&
          o !== "static" &&
          (c[u] = o);
      return Object.keys(c).length > 0 ? c : void 0;
    },
    n = (i, c) => {
      let u = i.selector || i.tagName || "element",
        o = i.selectorPath,
        d = i.componentName,
        a = i.componentFile,
        l = i.componentLine,
        f = d ? `${d}${a ? ` @ ${a}${l ? `:${l}` : ""}` : ""}` : void 0,
        m = i.layoutContext ?? {},
        p = m.textOverflow ?? i.textOverflow,
        h = m.flexSqueezeRisk ?? i.flexSqueezeRisk,
        $ = m.gridSelf ?? i.gridSelf,
        g = i.computedStyles,
        v =
          typeof i.innerText == "string"
            ? i.innerText.replace(/\s+/g, " ").trim().slice(0, 80)
            : void 0;
      if (p && p.isTruncated) {
        let S = p.scrollDimension ?? {},
          y = p.clientDimension ?? {},
          x = p.overflowDelta ?? {},
          k = String(p.truncationType ?? "truncated"),
          b = `text_overflow|${u}|${k}|${y.width ?? 0}x${y.height ?? 0}`,
          P = t.get(b);
        P
          ? c !== void 0 &&
            !P.anchorIndices.includes(c) &&
            P.anchorIndices.push(c)
          : t.set(b, {
              kind: "text_overflow",
              selector: u,
              selectorPath: o,
              component: f,
              anchorIndices: c !== void 0 ? [c] : [],
              summary: `${k} truncation (scroll ${S.width ?? "?"}x${S.height ?? "?"}px > client ${y.width ?? "?"}x${y.height ?? "?"}px, delta +${x.width ?? 0}px W / +${x.height ?? 0}px H)`,
              sampleText: v,
              keyStyles: s(g),
            });
      }
      if (h && h.isSqueezed) {
        let S = `flex_squeeze|${u}|${h.renderedWidth ?? 0}`,
          y = t.get(S);
        y
          ? c !== void 0 &&
            !y.anchorIndices.includes(c) &&
            y.anchorIndices.push(c)
          : t.set(S, {
              kind: "flex_squeeze",
              selector: u,
              selectorPath: o,
              component: f,
              anchorIndices: c !== void 0 ? [c] : [],
              summary: `Flex squeeze (intrinsic ${h.intrinsicWidth ?? "?"}px -> rendered ${h.renderedWidth ?? "?"}px, flex-shrink=${h.flexShrink ?? "?"})`,
              sampleText: v,
              keyStyles: s(g),
            });
      }
      if ($ && $.isGridOverflow) {
        let S = `grid_overflow|${u}`,
          y = t.get(S);
        y
          ? c !== void 0 &&
            !y.anchorIndices.includes(c) &&
            y.anchorIndices.push(c)
          : t.set(S, {
              kind: "grid_overflow",
              selector: u,
              selectorPath: o,
              component: f,
              anchorIndices: c !== void 0 ? [c] : [],
              summary: String($.reason ?? "Grid item overflowed track"),
              sampleText: v,
              keyStyles: s(g),
            });
      }
    };
  (e.anchors ?? []).forEach((i, c) => {
    n(i, c);
  });
  let r = (i) => {
    if (!i) return;
    n(i);
    let c = i.children;
    if (Array.isArray(c)) for (let u of c) r(u);
  };
  return (e.tree && r(e.tree), Array.from(t.values()));
}
function js(e, t) {
  let s = t.get(e);
  if (!s) return e;
  if (s.href)
    try {
      let n = new URL(s.href),
        r = n.pathname.split("/").filter(Boolean).pop() ?? n.pathname;
      return `${e}:${r}`;
    } catch {
      let n = s.href.split("?")[0],
        r = n.split("/").filter(Boolean).pop() ?? n.slice(-30);
      return `${e}:${r}`;
    }
  return `${e}:inline`;
}
function Bs(e) {
  let t = [];
  if (e.styleProps && Object.keys(e.styleProps).length > 0)
    for (let [s, n] of Object.entries(e.styleProps))
      ht.test(s) && t.push(`${s}: ${n}`);
  else if (e.cssText) {
    let s = e.cssText.match(/\{([\s\S]*)\}/),
      n = s ? s[1] : e.cssText;
    for (let r of n.split(";")) {
      let i = r.trim();
      if (!i) continue;
      let c = i.indexOf(":");
      if (c > 0) {
        let u = i.slice(0, c).trim();
        ht.test(u) && t.push(i);
      }
    }
  }
  return t;
}
function an(e) {
  if (!e) return [];
  let t = e.sheets ?? [],
    s = e.rules ?? [],
    n = e.elements ?? [],
    r = new Map();
  for (let a of t) r.set(a.id, a);
  let i = new Map();
  for (let a of s) i.set(a.id, a);
  let c = [];
  c.push(`
## CSS Cascade Index (${t.length} stylesheets, ${s.length} rules, ${n.length} indexed elements)`);
  let u = new Set();
  for (let a of n)
    for (let l of a.matchedRuleIds ?? []) {
      let f = i.get(l);
      f && u.add(f.sheetId);
    }
  let o = t.filter((a) => !!a.href && (u.size === 0 || u.has(a.id))),
    d = t.filter((a) => !a.href).length;
  if (o.length > 0 || d > 0) {
    c.push("### Active Stylesheets (referenced by captured elements)");
    for (let a of o.slice(0, 12))
      c.push(`- \`${a.id}\`: ${a.href} (${a.rulesCount ?? 0} rules)`);
    (o.length > 12 && c.push(`- ... +${o.length - 12} more active stylesheets`),
      d > 0 && c.push(`- \`inline <style>\`: ${d} inline style tag(s)`));
  }
  if (n.length > 0) {
    c.push("### Indexed Elements & Key Layout/Wrapping Rule Overrides");
    let a = new Map(),
      l = [];
    n.forEach((f, m) => {
      let p = `${f.tagName}|${(f.matchedRuleIds ?? []).join(",")}`,
        h = a.get(p);
      h ? h.push(f.id) : (a.set(p, [f.id]), l.push({ idx: m, el: f, sig: p }));
    });
    for (let { idx: f, el: m, sig: p } of l.slice(0, 12)) {
      let h = m.matchedRuleIds ?? [],
        $ = a.get(p) ?? [m.id],
        g = $.length > 1 ? ` (also ${$.slice(1).join(", ")})` : "",
        v = new Map();
      for (let S of h) {
        let y = i.get(S);
        if (!y) continue;
        let x = Bs(y);
        if (x.length === 0) continue;
        let k = `${y.selectorText}||${x.join(";")}`,
          b = js(y.sheetId, r),
          P = v.get(k);
        P
          ? (P.ruleIds.push(S), P.sheetRefs.add(b))
          : v.set(k, {
              rule: y,
              decls: x,
              ruleIds: [S],
              sheetRefs: new Set([b]),
            });
      }
      c.push(
        `- **[${f}] \`${m.id}\`${g} \`<${m.tagName}>\` \`${m.selector}\`** (${h.length} matched rules)`,
      );
      for (let S of v.values()) {
        let y =
            S.ruleIds.length > 1
              ? `${S.ruleIds[0]} (+${S.ruleIds.length - 1})`
              : S.ruleIds[0],
          x = Array.from(S.sheetRefs).slice(0, 2).join(", ");
        c.push(
          `  - [${y} @ ${x}] \`${S.rule.selectorText}\` -> \`${S.decls.join("; ")}\``,
        );
      }
    }
    l.length > 12 &&
      c.push(
        `- ... +${l.length - 12} more elements (call \`get_scene(selector="...")\` or \`search_pack\` to inspect)`,
      );
  }
  return c;
}
function Le(e, t, s) {
  let n = [],
    r = s.selector?.trim().toLowerCase(),
    i = s.cssProperty?.trim().toLowerCase(),
    c = i ? new RegExp(i, "i") : void 0,
    u = e?.anchors ?? [],
    o = [];
  (u.forEach((l, f) => {
    if (!r) {
      o.push({ idx: f, anchor: l });
      return;
    }
    `${f} ${l.selector ?? ""} ${l.selectorPath ?? ""} ${l.tagName ?? ""} ${l.componentName ?? ""} ${l.componentFile ?? ""} ${l.innerText ?? ""}`
      .toLowerCase()
      .includes(r) && o.push({ idx: f, anchor: l });
  }),
    n.push(`## Matched DOM Anchors (${o.length} of ${u.length})`));
  let d = new Map(),
    a = [];
  for (let l of o) {
    let f = l.anchor,
      m = f.layoutContext?.textOverflow?.truncationType,
      p = `${f.selectorPath ?? f.selector}|${f.componentName ?? ""}|${m ?? ""}|${JSON.stringify(f.intentFlags ?? {})}`,
      h = d.get(p);
    h
      ? (h.push(l.idx),
        r && o.length <= 10 && a.push({ ...l, sig: `${p}#${l.idx}` }))
      : (d.set(p, [l.idx]), a.push({ ...l, sig: p }));
  }
  for (let { idx: l, anchor: f, sig: m } of a.slice(0, 30)) {
    let p = d.get(m) ?? [l],
      h =
        p.length > 1
          ? ` (and ${p.length - 1} identical sibling anchor(s): [${p.slice(1, 8).join(", ")}${p.length > 8 ? ", ..." : ""}])`
          : "",
      $ = f.componentName
        ? ` [${f.componentName}${f.componentFile ? ` @ ${f.componentFile}:${f.componentLine ?? ""}` : ""}]`
        : "";
    if (
      (n.push(
        `- **[${l}] \`${f.selectorPath ?? f.selector ?? "?"}\`**${$}${h}`,
      ),
      f.intentFlags &&
        Object.keys(f.intentFlags).length > 0 &&
        n.push(`  - flags: ${JSON.stringify(f.intentFlags)}`),
      f.innerText &&
        n.push(
          `  - text: "${f.innerText.replace(/\s+/g, " ").trim().slice(0, 140)}"`,
        ),
      f.relativeRect && n.push(`  - rect: ${JSON.stringify(f.relativeRect)}`),
      f.boxModel && n.push(`  - boxModel: ${JSON.stringify(f.boxModel)}`),
      f.computedStyles && Object.keys(f.computedStyles).length > 0)
    ) {
      let g = c
        ? Object.fromEntries(
            Object.entries(f.computedStyles).filter(
              ([v, S]) => c.test(v) || c.test(S),
            ),
          )
        : f.computedStyles;
      n.push(`  - computedStyles: ${JSON.stringify(g)}`);
    }
    f.layoutContext &&
      Object.keys(f.layoutContext).length > 0 &&
      n.push(`  - layoutContext: ${JSON.stringify(f.layoutContext)}`);
  }
  if (t) {
    let l = t.sheets ?? [],
      f = t.rules ?? [],
      m = t.elements ?? [],
      p = new Map();
    for (let g of l) p.set(g.id, g);
    let h = new Map();
    for (let g of f) h.set(g.id, g);
    let $ = [];
    (m.forEach((g, v) => {
      if (!r) {
        $.push({ idx: v, el: g });
        return;
      }
      `${v} ${g.id} ${g.tagName} ${g.selector}`.toLowerCase().includes(r) &&
        $.push({ idx: v, el: g });
    }),
      n.push(`
## Matched CSS Cascade Elements (${$.length} of ${m.length})`));
    for (let { idx: g, el: v } of $.slice(0, 20)) {
      n.push(`- **[${g}] \`${v.id}\` \`<${v.tagName}>\` \`${v.selector}\`**`);
      let S = new Map();
      for (let y of v.matchedRuleIds ?? []) {
        let x = h.get(y);
        if (!x || (c && !c.test(x.cssText) && !c.test(x.selectorText)))
          continue;
        let k = `${x.selectorText}||${x.cssText}`,
          b = p.get(x.sheetId),
          P = b?.href
            ? `${x.sheetId} (${b.href})`
            : `${x.sheetId} (inline <${b?.ownerNodeTag ?? "style"}>)`,
          R = S.get(k);
        R
          ? (R.ruleIds.push(y), R.sheetHrefs.add(P))
          : S.set(k, { rule: x, ruleIds: [y], sheetHrefs: new Set([P]) });
      }
      if (S.size === 0) n.push("  - (no matched rules for filter)");
      else
        for (let y of S.values()) {
          let x = y.ruleIds.join(", "),
            k = Array.from(y.sheetHrefs).join(" | ");
          n.push(
            `  - **[${x}]** [sheet: ${k}] \`${y.rule.selectorText}\` -> \`${y.rule.cssText}\``,
          );
        }
      if (v.inheritedRules && v.inheritedRules.length > 0)
        for (let y of v.inheritedRules) {
          let x = JSON.stringify(y.inheritedProps ?? {});
          if (c && !c.test(x) && !c.test(y.ancestorSelector)) continue;
          let k = h.get(y.ruleId),
            P = (k ? p.get(k.sheetId) : void 0)?.href ?? k?.sheetId ?? "?";
          n.push(
            `  - *[inherited from \`<${y.ancestorTagName}> ${y.ancestorSelector}\` via ${y.ruleId} @ ${P}]*: ${x}`,
          );
        }
    }
  }
  return n;
}
function cn(e) {
  if (e)
    try {
      return JSON.parse(e);
    } catch {
      return;
    }
}
function ln(e) {
  let t = M(e.pack);
  if (t.kind === "screenshot") {
    if (e.format === "json")
      return w(
        JSON.stringify(
          {
            kind: "screenshot",
            selectorFilter: e.selector ?? null,
            propertyFilter: e.property ?? null,
            anchors: t.domContext?.anchors ?? [],
            rules: t.cascade?.rules ?? [],
          },
          null,
          2,
        ),
        e.maxChars,
      );
    let y = Le(t.domContext, t.cascade, {
      selector: e.selector,
      cssProperty: e.property,
    });
    return w(
      y.join(`
`),
      e.maxChars,
    );
  }
  let s = t.getIssueScenes();
  if (s.length === 0)
    return "No issueScenes found in this session pack. Capture an issue scene or pass a screenshot pack.";
  let n =
      e.sceneId ??
      e.scene ??
      (e.sceneIndex !== void 0 ? String(e.sceneIndex) : void 0),
    r = n ? s.find((y) => y.id === n || String(y.index) === n) : s[0];
  if (!r) {
    let y = s.map((x) => `${x.index}:${x.id}`).join(", ");
    throw new Error(
      `SCENE_NOT_FOUND: Scene "${n}" not found. Available scenes: [${y}]`,
    );
  }
  let i = cn(
      t.getTextFile(r.domStylesPath ?? `issues/${r.id}/dom-styles.json`),
    ) ?? {
      sceneId: r.id,
      targetSelector: r.targetSelector,
      computedLayoutStyles: r.scene.target?.computedStyle ?? {},
      winnerRules: r.scene.target?.winnerRules ?? [],
    },
    c = cn(
      t.getTextFile(r.domContextPath ?? `issues/${r.id}/dom-context.json`),
    ),
    u = (y, ...x) => {
      if (y.length === 0) return !0;
      let k = x.map((b) => String(b ?? "").toLowerCase());
      return y.some((b) => k.some((P) => P.includes(b)));
    },
    o = (y) =>
      y
        ? y
            .toLowerCase()
            .split("|")
            .map((x) => x.trim())
            .filter(Boolean)
        : [],
    d = o(e.selector),
    a = o(e.property),
    l = i.computedLayoutStyles ?? {},
    f =
      a.length > 0
        ? Object.fromEntries(Object.entries(l).filter(([y, x]) => u(a, y, x)))
        : l,
    m = i.winnerRules ?? [],
    p = m.filter((y) =>
      u(d, `${y.selector ?? ""} ${y.source ?? ""}`)
        ? a.length > 0
          ? Object.entries(y.properties ?? {}).some(([x, k]) => u(a, x, k))
          : !0
        : !1,
    ),
    h = c?.triggerElement ?? r.scene.target?.triggerElement,
    $ = c?.relatedOverlays ?? r.scene.target?.relatedOverlays;
  if (e.format === "json")
    return w(
      JSON.stringify(
        {
          kind: "session",
          sceneId: r.id,
          sceneIndex: r.index,
          targetSelector:
            i.targetSelector ?? r.targetSelector ?? c?.targetSelector,
          computedLayoutStyles: f,
          winnerRules: p,
          ...(h ? { triggerElement: h } : {}),
          ...($?.length ? { relatedOverlays: $ } : {}),
        },
        null,
        2,
      ),
      e.maxChars,
    );
  let g = [],
    v = i.targetSelector ?? r.targetSelector ?? c?.targetSelector ?? "\u2014";
  (g.push(
    `# Winner CSS & Computed Layout Styles (Scene [${r.index}] \`${r.id}\`)`,
  ),
    g.push(`- **Target Selector**: \`${v}\``),
    h &&
      g.push(
        `- **Portal Trigger Element**: \`${h.selectorPath ?? h.tagName ?? "?"}\`${h.componentName ? ` (component: \`${h.componentName}\`)` : ""}`,
      ),
    $ &&
      $.length > 0 &&
      g.push(
        `- **Related Portal Overlays (${$.length})**: ${$.map((y) => `${y.tagName ?? "div"}${y.id ? `#${y.id}` : ""} (${y.relationReason ?? "linked"})`).join(", ")}`,
      ));
  let S = Object.entries(f);
  if (
    (g.push(`
## Computed Layout Styles (${S.length})`),
    S.length === 0)
  )
    g.push("(No computed layout properties matched)");
  else for (let [y, x] of S) g.push(`- \`${y}\`: \`${x}\``);
  if (
    (g.push(`
## Winner CSS Rules (${p.length} of ${m.length})`),
    p.length === 0)
  )
    g.push("(No winner rules recorded or matched filter)");
  else
    for (let y of p) {
      g.push(
        `- **\`${y.selector}\`** \u2014 \`${y.source}\`${y.specificity ? ` (specificity: \`${y.specificity}\`)` : ""}`,
      );
      for (let [x, k] of Object.entries(y.properties ?? {}))
        u(a, x, k) && g.push(`  - \`${x}: ${k}\``);
    }
  return w(
    g.join(`
`),
    e.maxChars,
  );
}
function I(e) {
  if (typeof e != "number" || !Number.isFinite(e)) return "\u2014";
  let t = e >= 0 ? "+" : "-",
    s = Math.abs(e) / 1e3;
  return `${t}${s.toFixed(1)}s`;
}
function Y(e) {
  return typeof e != "number" || !Number.isFinite(e)
    ? "\u2014"
    : e < 1e3
      ? `${Math.round(e)}ms`
      : `${(e / 1e3).toFixed(2)}s`;
}
function Ds(e) {
  let t = e.trim().replace(/^\$\.?/, "");
  if (!t) return [];
  let s = [],
    n = /([^.[\]]+)|\[([^\]]+)\]/g,
    r;
  for (; (r = n.exec(t)) !== null;)
    if (r[1] !== void 0) s.push({ kind: "prop", key: r[1] });
    else if (r[2] !== void 0) {
      let i = r[2].trim();
      if (i === "*") s.push({ kind: "wildcard" });
      else if (/^-?\d+$/.test(i))
        s.push({ kind: "index", index: Number.parseInt(i, 10) });
      else {
        let c =
          /^(?:\?\(\s*)?(?:@\.)?([a-zA-Z0-9_$-]+)\s*={1,3}\s*(.+?)(?:\s*\))?$/.exec(
            i,
          );
        if (c) {
          let u = c[1].trim(),
            o = c[2].trim().replace(/^['"]|['"]$/g, "");
          s.push({ kind: "filter", field: u, value: o });
        } else {
          let u = i.replace(/^['"]|['"]$/g, "");
          s.push({ kind: "prop", key: u });
        }
      }
    }
  return s;
}
function se(e, t) {
  let s = Ds(t);
  if (s.length === 0) return e;
  let n = [e],
    r = !1;
  for (let i of s) {
    let c = [];
    for (let u of n)
      if (u != null) {
        if (i.kind === "prop") {
          if (typeof u == "object" && !Array.isArray(u)) {
            let o = u[i.key];
            o !== void 0 && c.push(o);
          }
        } else if (i.kind === "index") {
          if (Array.isArray(u)) {
            let o = i.index < 0 ? u.length + i.index : i.index;
            o >= 0 && o < u.length && c.push(u[o]);
          }
        } else if (i.kind === "wildcard")
          ((r = !0),
            Array.isArray(u)
              ? c.push(...u)
              : typeof u == "object" && c.push(...Object.values(u)));
        else if (i.kind === "filter" && ((r = !0), Array.isArray(u))) {
          for (let o of u)
            if (o && typeof o == "object") {
              let d = o[i.field];
              String(d) === i.value && c.push(o);
            }
        }
      }
    n = c;
  }
  return r ? n : n.length === 1 ? n[0] : n;
}
function Oe(e) {
  let t = [];
  return (
    e.snapshot?.targetComponent && t.push(e.snapshot.targetComponent),
    e.snapshot?.rootComponent && t.push(e.snapshot.rootComponent),
    Array.isArray(e.snapshot?.parentChain) && t.push(...e.snapshot.parentChain),
    t.length === 0 && Array.isArray(e.components) && t.push(...e.components),
    t
  );
}
function pt(e) {
  return e.webStorageDiff
    ? {
        isDiff: !0,
        local:
          e.webStorageDiff.localStorageChanged ?? e.webStorageDiff.localStorage,
        session:
          e.webStorageDiff.sessionStorageChanged ??
          e.webStorageDiff.sessionStorage,
      }
    : {
        isDiff: !1,
        local: e.webStorage?.localStorage,
        session: e.webStorage?.sessionStorage,
      };
}
function un(e) {
  let t = M(e.pack);
  if (t.kind === "screenshot") {
    let a =
        t.environment?.frameworkComponentStates ??
        t.environment?.vueComponentStates ??
        [],
      l = e.component?.toLowerCase(),
      f = l
        ? a.filter((p) => (p.componentName ?? "").toLowerCase().includes(l))
        : a;
    if (e.path) return w(JSON.stringify(se(f, e.path), null, 2), e.maxChars);
    if (e.format === "json")
      return w(
        JSON.stringify({ totalComponents: a.length, components: f }, null, 2),
        e.maxChars,
      );
    if (f.length === 0)
      return "No framework component states recorded in this screenshot pack.";
    let m = [
      `# Screenshot Pack Component States (${f.length} of ${a.length})`,
      ...f.map(
        (
          p,
        ) => `- **${p.componentName ?? "Anonymous"}** (${p.framework ?? "vue/react"})${p.componentFile ? ` @ ${p.componentFile}:${p.componentLine ?? ""}` : ""}
  - props: ${JSON.stringify(p.props ?? {})}
  - data: ${JSON.stringify(p.data ?? p.state ?? {})}`,
      ),
    ];
    return w(
      m.join(`
`),
      e.maxChars,
    );
  }
  let s = t.getFrameworkStates();
  if (s.length === 0)
    return "No frameworkStates were captured in this session pack.";
  let n = e.index;
  if (n === void 0 && e.nearMs !== void 0) {
    let a = 0,
      l = 1 / 0;
    (s.forEach((f, m) => {
      let p = t.toRelativeMs(f.capturedAtEpochMs) ?? 0,
        h = Math.abs(p - e.nearMs);
      h < l && ((l = h), (a = m));
    }),
      (n = a));
  } else if (n === void 0 && e.component) {
    let a = e.component.toLowerCase();
    for (let l = s.length - 1; l >= 0; l -= 1)
      if (
        Oe(s[l]).some((m) => (m.componentName ?? "").toLowerCase().includes(a))
      ) {
        n = l;
        break;
      }
  }
  let r = n ?? s.length - 1,
    i = s[r];
  if (!i)
    throw new Error(
      `FRAMEWORK_STATE_NOT_FOUND: Index ${r} out of range (0..${s.length - 1})`,
    );
  if (e.path) {
    let a = se(i, e.path);
    return w(
      JSON.stringify(
        {
          stateIndex: r,
          relativeMs: t.toRelativeMs(i.capturedAtEpochMs),
          path: e.path,
          value: a,
        },
        null,
        2,
      ),
      e.maxChars,
    );
  }
  let c = e.component?.toLowerCase();
  if (e.format === "json")
    return w(
      JSON.stringify(
        {
          totalStates: s.length,
          overview: s.map((a, l) => {
            let f = pt(a);
            return {
              index: l,
              relativeMs: t.toRelativeMs(a.capturedAtEpochMs),
              trigger: a.trigger,
              components: Oe(a)
                .map((m) => m.componentName)
                .filter(Boolean),
              localStorageKeys: Object.keys(f.local ?? {}),
              sessionStorageKeys: Object.keys(f.session ?? {}),
              hasWebStorageDiff: f.isDiff,
            };
          }),
          selectedIndex: r,
          selectedState: i,
        },
        null,
        2,
      ),
      e.maxChars,
    );
  let u = [];
  (u.push(`# Framework States (${s.length} snapshots in pack)`),
    u.push(`
## Snapshot Index Overview`),
    s.forEach((a, l) => {
      let f = t.toRelativeMs(a.capturedAtEpochMs),
        m = Oe(a)
          .map((S) => S.componentName)
          .filter(Boolean),
        p = pt(a),
        h = Object.keys(p.local ?? {}),
        $ = Object.keys(p.session ?? {}),
        g = p.isDiff ? "diff" : "keys",
        v = l === r ? " <-- [SELECTED]" : "";
      u.push(
        `- **[${l}]** ${I(f)} trigger=\`${a.trigger ?? "?"}\` | components=[${m.slice(0, 5).join(", ") || "none"}] | localStorage(${g})=${h.length} | sessionStorage(${g})=${$.length}${v}`,
      );
    }));
  let o = t.toRelativeMs(i.capturedAtEpochMs);
  u.push(`
## Selected Snapshot [${r}] (at ${I(o)}, trigger=\`${i.trigger ?? "?"}\`)`);
  let d = Oe(i).filter((a) =>
    c ? (a.componentName ?? "").toLowerCase().includes(c) : !0,
  );
  if (d.length > 0) {
    u.push(`
### Component Tree / Chain (${d.length})`);
    for (let a of d) {
      let l = a.componentFile
        ? ` @ ${a.componentFile}${a.componentLine !== void 0 ? `:${a.componentLine}` : ""}`
        : "";
      (u.push(
        `- **${a.componentName ?? "Anonymous"}** (${a.framework ?? "framework"} v${a.version ?? "?"})${l}`,
      ),
        a.props &&
          Object.keys(a.props).length > 0 &&
          u.push(`  - props: ${JSON.stringify(a.props)}`));
      let f = a.state ?? a.data;
      f &&
        Object.keys(f).length > 0 &&
        u.push(`  - state: ${JSON.stringify(f)}`);
    }
  } else
    u.push(`
### Component Tree
(No component tree recorded on snapshot [${r}])`);
  if (
    (i.globalState &&
      Object.keys(i.globalState).length > 0 &&
      (u.push(`
### Global State`),
      u.push(JSON.stringify(i.globalState, null, 2))),
    i.webStorage)
  ) {
    let a = i.webStorage;
    (u.push(`
### Web Storage (redactedValues: ${!!a.redactedValues})`),
      a.localStorage &&
        Object.keys(a.localStorage).length > 0 &&
        (u.push("#### localStorage"),
        u.push(JSON.stringify(a.localStorage, null, 2))),
      a.sessionStorage &&
        Object.keys(a.sessionStorage).length > 0 &&
        (u.push("#### sessionStorage"),
        u.push(JSON.stringify(a.sessionStorage, null, 2))));
  }
  if (i.webStorageDiff) {
    let a = pt(i);
    (u.push(`
### Web Storage Diff (delta vs previous state)`),
      a.local &&
        Object.keys(a.local).length > 0 &&
        (u.push("#### localStorage diff"),
        u.push(JSON.stringify(a.local, null, 2))),
      a.session &&
        Object.keys(a.session).length > 0 &&
        (u.push("#### sessionStorage diff"),
        u.push(JSON.stringify(a.session, null, 2))));
  }
  return w(
    u.join(`
`),
    e.maxChars,
  );
}
function mt(e, t = 40) {
  if (typeof e != "string") return "";
  let s = e.replace(/\s+/g, " ").trim();
  return s.length <= t ? s : `${s.slice(0, t)}\u2026`;
}
function zs(e) {
  if (!e) return "";
  if ("targetComponent" in e || "rootComponent" in e) {
    let s = e,
      n = s.targetComponent ?? s.parentChain?.[0] ?? s.rootComponent;
    return n?.componentName ? ` [${n.componentName}]` : "";
  }
  let t = e;
  return t.componentName ? ` [${t.componentName}]` : "";
}
function gt(e, t = 40) {
  if (!e) return "<unknown>";
  let s = (e.tagName || "element").toLowerCase(),
    n = e.id ? `#${e.id}` : "",
    r = Array.isArray(e.classNames)
      ? e.classNames.filter(Boolean).slice(0, 3)
      : [],
    i = r.length > 0 ? `.${r.join(".")}` : "",
    c = mt(e.text ?? e.accessibleName, t),
    u = c ? ` "${c}"` : "",
    o = zs(e.framework);
  return `<${s}${n}${i}${u}>${o}`;
}
function he(e, t, s) {
  let n = e.element ?? e.target,
    r = I(s ?? e.elapsedMs),
    i = e.kind ?? "event",
    c = gt(n),
    u = e.input?.data ?? e.input?.value ?? n?.value ?? n?.attributes?.value,
    o =
      e.input?.key ??
      (typeof e.metadata?.shortcut == "string"
        ? e.metadata.shortcut
        : void 0) ??
      (typeof e.metadata?.key == "string" ? e.metadata.key : void 0),
    d = typeof e.metadata?.toUrl == "string" ? e.metadata.toUrl : void 0,
    a = [];
  (u !== void 0 && u !== "" && a.push(`val="${mt(String(u), 50)}"`),
    o && a.push(`key=${o}`),
    d && a.push(`to=${mt(d, 80)}`),
    e.screenshot?.dataUrl && a.push(`img=${e.screenshot.dataUrl}`));
  let l = a.length > 0 ? ` ${a.join(" ")}` : "";
  return `[${t}] ${r} [${i}] ${c}${l}`;
}
function fn(e) {
  let t = M(e.pack);
  if (t.kind !== "session")
    throw new Error(
      `UNSUPPORTED_PACK_KIND: get_interactions requires a session evidence pack, but "${e.pack}" is a screenshot pack.`,
    );
  let s = t.getInteractions(),
    n =
      e.kinds && e.kinds.length > 0
        ? new Set(e.kinds.map((d) => d.toLowerCase()))
        : void 0,
    r = s
      .map((d, a) => ({
        index: a,
        relativeMs: t.toRelativeMs(d.createdAt) ?? d.elapsedMs,
        item: d,
      }))
      .filter(
        ({ index: d, item: a }) =>
          !(
            (e.fromIndex !== void 0 && d < e.fromIndex) ||
            (n && !n.has((a.kind ?? "").toLowerCase()))
          ),
      ),
    i = Math.max(1, e.limit ?? 60),
    c = r.slice(0, i),
    u;
  if (e.format === "json")
    u = w(
      JSON.stringify(
        { totalInteractions: s.length, matchedCount: r.length, items: c },
        null,
        2,
      ),
      e.maxChars,
    );
  else {
    let d = [];
    if (
      (d.push(
        `# Recorded Interactions (showing ${c.length} of ${r.length} matched, total=${s.length})`,
      ),
      c.length === 0)
    )
      d.push("(No interactions matched)");
    else
      for (let { index: a, relativeMs: l, item: f } of c)
        d.push(`- ${he(f, a, l)}`);
    if (r.length > c.length) {
      let a = (c[c.length - 1]?.index ?? 0) + 1;
      d.push(`
\u2026 ${r.length - c.length} more interactions available. Pass fromIndex=${a} to continue.`);
    }
    u = w(
      d.join(`
`),
      e.maxChars,
    );
  }
  let o = [{ type: "text", text: u }];
  if (e.includeScreenshot)
    for (let { index: d, item: a } of c.slice(0, 3)) {
      let l =
        a.screenshot?.dataUrl && !a.screenshot.dataUrl.startsWith("data:")
          ? a.screenshot.dataUrl
          : void 0;
      l && o.push(...F(t, l, `Interaction [${d}] screenshot`));
    }
  return o;
}
var re = new Set([
    0,
    200,
    "0",
    "0000",
    "000000",
    "200",
    "SUCCESS",
    "OK",
    "success",
    "ok",
  ]),
  yt =
    /err|fail|invalid|denied|timeout|reject|not_found|unauthor|forbidden|exception/i,
  qs = new Set(["image", "font", "media", "stylesheet"]),
  Us = [
    "image/",
    "font/",
    "audio/",
    "video/",
    "text/css",
    "application/javascript",
    "text/javascript",
  ];
function Js(e) {
  let t = e.message ?? e.msg ?? e.errorMsg ?? e.error;
  if (typeof t == "string") return t;
  if (t && typeof t == "object" && "message" in t) {
    let s = t.message;
    return typeof s == "string" ? s : JSON.stringify(t);
  }
}
function je(e) {
  return e != null && e !== "" && typeof e != "boolean" && !re.has(e);
}
function Ws(e) {
  let t = /"(?:success|isSuccess)"\s*:\s*false/i.test(e),
    s = /"(?:errorCode|errCode)"\s*:\s*(?:"([^"\\]+)"|(-?[1-9]\d*))/.exec(e),
    n = /"(?:code|retCode)"\s*:\s*(?:"([^"\\]+)"|(0|-?[1-9]\d*))/.exec(e),
    r = s?.[1] ?? s?.[2],
    i = r !== void 0 && r.length > 0 && !re.has(r),
    c = n?.[1] ?? n?.[2],
    u =
      c !== void 0 &&
      c.length > 0 &&
      !re.has(c) &&
      (/-?[1-9]\d{2,}|-\d+/.test(c) || yt.test(c));
  if (!t && !i && !u) return;
  let o = (i ? r : void 0) ?? (u ? c : void 0) ?? n?.[1] ?? n?.[2] ?? "FAIL";
  if (re.has(o) && !t)
    return { isBizError: !1, matchedRule: "heuristic_regex_success" };
  let d =
    /"(?:message|msg|errorMsg|error)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/.exec(e);
  return {
    isBizError: !0,
    code: o,
    message: d ? d[1] : void 0,
    matchedRule: "heuristic_regex",
  };
}
function dn(e) {
  let t = e.trim();
  if (!t.startsWith("{") && !t.startsWith("["))
    return { isBizError: !1, matchedRule: "not_json" };
  try {
    let s = JSON.parse(t);
    if (!s || typeof s != "object" || Array.isArray(s))
      return { isBizError: !1, matchedRule: "primitive_json" };
    let n = s,
      r = Js(n);
    if (n.success === !1 || n.isSuccess === !1 || n.result === !1)
      return {
        isBizError: !0,
        code: n.code ?? n.errCode ?? n.errorCode ?? n.result ?? "FAIL",
        message: r,
        matchedRule: "explicit_success_false",
      };
    let i = n.errorCode ?? n.errCode;
    if (je(i))
      return {
        isBizError: !0,
        code: i,
        message: r,
        matchedRule: "explicit_error_code",
      };
    let c = n.success === !0 || n.isSuccess === !0,
      u = n.code ?? n.retCode;
    if (je(u) && !c)
      return {
        isBizError: !0,
        code: u,
        message: r,
        matchedRule: "abnormal_code_value",
      };
    if (
      !c &&
      u === void 0 &&
      (typeof n.result == "number" || typeof n.result == "string") &&
      je(n.result) &&
      (typeof n.result == "number" || yt.test(n.result))
    )
      return {
        isBizError: !0,
        code: n.result,
        message: r,
        matchedRule: "abnormal_result_value",
      };
    if (!c && n.status !== void 0 && n.status !== null) {
      if (typeof n.status == "number" && !re.has(n.status))
        return {
          isBizError: !0,
          code: n.status,
          message: r,
          matchedRule: "abnormal_status_number",
        };
      if (
        typeof n.status == "string" &&
        !re.has(n.status) &&
        !re.has(n.status.toLowerCase()) &&
        yt.test(n.status)
      )
        return {
          isBizError: !0,
          code: n.status,
          message: r,
          matchedRule: "abnormal_status_string",
        };
    }
    let o =
      n.error && typeof n.error == "object" && Object.keys(n.error).length > 0;
    if (
      (typeof n.error == "string" && n.error.length > 0) ||
      (typeof n.exception == "string" && n.exception.length > 0) ||
      o
    ) {
      let d =
          typeof n.error == "string"
            ? n.error
            : typeof n.exception == "string"
              ? n.exception
              : (n.error?.message ?? JSON.stringify(n.error)),
        a = o ? n.error.code : void 0;
      return {
        isBizError: !0,
        code: (je(u) ? u : void 0) ?? a ?? "EXCEPTION",
        message: d,
        matchedRule: "exception_field_present",
      };
    }
  } catch {
    let s = Ws(e);
    if (s) return s;
  }
  return { isBizError: !1, matchedRule: "none" };
}
function Be(e) {
  let t = e.status ?? 0;
  return t === 0 || t >= 400 || !!e.errorText;
}
function vt(e, t, s = {}) {
  if (t.businessError)
    return {
      isBizError: !0,
      code: t.businessError.code ?? "FAIL",
      message: t.businessError.message,
      matchedRule: "manifest_v5_pretagged",
    };
  let n = t.status ?? 0;
  if (!s.allowBodyScan || n < 200 || n >= 300)
    return { isBizError: !1, matchedRule: "skipped" };
  let r = (t.type ?? "").toLowerCase();
  if (r && qs.has(r))
    return { isBizError: !1, matchedRule: "skipped_non_api_type" };
  let i = (t.response?.mimeType ?? "").toLowerCase();
  if (i && Us.some((u) => i.startsWith(u)))
    return { isBizError: !1, matchedRule: "skipped_non_json_mime" };
  if (
    s.maxScanBytes !== void 0 &&
    typeof t.response?.byteLength == "number" &&
    t.response.byteLength > s.maxScanBytes &&
    typeof t.response?.body != "string"
  )
    return { isBizError: !1, matchedRule: "skipped_size_limit" };
  let c = e.getNetworkBody(t);
  return c ? dn(c) : { isBizError: !1, matchedRule: "no_body" };
}
function St(e, t, s = !1) {
  return t?.isBizError
    ? `${e} [BIZ_ERR: code=${t.code ?? "ERR"}]`
    : s
      ? `!${e}`
      : String(e);
}
function Hs(e, t, s) {
  if (!t || t === "all") return !0;
  if (t === "biz_error") return !!s?.isBizError;
  let n = e.status ?? 0;
  return t === "failed"
    ? Be(e)
    : t === "4xx"
      ? n >= 400 && n < 500
      : t === "5xx"
        ? n >= 500 && n < 600
        : t === "2xx"
          ? n >= 200 && n < 300
          : t === "3xx"
            ? n >= 300 && n < 400
            : Array.isArray(t)
              ? t.includes(n)
              : !0;
}
function De(e, t = {}) {
  let s = e.getNetworkEntries(),
    n = t.urlContains?.toLowerCase(),
    r = t.method?.toUpperCase(),
    i = t.type?.toLowerCase(),
    c = !!(t.bizError || t.bizCode || t.status === "biz_error"),
    u = t.bizCode
      ? t.bizCode
          .split(",")
          .map((l) => l.trim().toLowerCase())
          .filter(Boolean)
      : [],
    o = [];
  for (let l of s) {
    if (
      (n && !l.url.toLowerCase().includes(n)) ||
      (r && (l.method ?? "GET").toUpperCase() !== r) ||
      (i && (l.type ?? "").toLowerCase() !== i) ||
      (t.status && t.status !== "biz_error" && !Hs(l, t.status))
    )
      continue;
    let f = l.status ?? 0,
      m = vt(e, l, { allowBodyScan: c });
    if (t.bizError && !m.isBizError) continue;
    if (u.length > 0) {
      if (!m.isBizError) continue;
      let g = String(m.code ?? "").toLowerCase();
      if (!u.some((v) => g.includes(v))) continue;
    }
    if (t.status === "biz_error" && !m.isBizError) continue;
    let h = Be(l) || m.isBizError,
      $ =
        !!l.response?.bodyPath ||
        !!l.response?.bodyHash ||
        typeof l.response?.body == "string" ||
        l.response?.bodyStatus === "captured";
    o.push({
      id: l.id,
      relativeMs: e.toRelativeMs(l.createdAt),
      method: l.method ?? "GET",
      status: f,
      durationMs: l.durationMs,
      type: l.type,
      url: l.url,
      mimeType: l.response?.mimeType,
      bodyStatus: l.response?.bodyStatus,
      byteLength: l.response?.byteLength,
      hasBody: $,
      isFailure: h,
      isBizError: m.isBizError ? !0 : void 0,
      bizErrorCode: m.code,
      bizErrorMessage: m.message,
    });
  }
  !t.status &&
    !t.bizError &&
    o.sort((l, f) =>
      l.isFailure !== f.isFailure
        ? l.isFailure
          ? -1
          : 1
        : (l.relativeMs ?? 0) - (f.relativeMs ?? 0),
    );
  let d = Math.max(0, t.offset ?? 0),
    a = Math.max(1, t.limit ?? 50);
  return {
    totalEntries: s.length,
    matchedCount: o.length,
    offset: d,
    limit: a,
    items: o.slice(d, d + a),
  };
}
function ze(e) {
  let t = I(e.relativeMs),
    s = Y(e.durationMs),
    n = St(
      e.status,
      { isBizError: !!e.isBizError, code: e.bizErrorCode },
      e.isFailure && !e.isBizError,
    ),
    r = e.hasBody
      ? `[body:${e.byteLength ?? "?"}B]`
      : `[${e.bodyStatus ?? "no-body"}]`,
    i = e.bizErrorMessage ? ` (bizError: ${e.bizErrorMessage})` : "";
  return `${e.id} | ${t} | ${e.method} ${n} (${s}) | ${e.type ?? "?"} | ${r} | ${e.url}${i}`;
}
function hn(e, t, s = {}) {
  let n = e.getNetworkEntries(),
    r =
      n.find((f) => f.id === t) ??
      n.find((f) => f.id.endsWith(t) || f.url.includes(t));
  if (!r)
    throw new Error(
      `REQUEST_NOT_FOUND: No network entry found matching "${t}". Call query_network first to list available entry IDs.`,
    );
  let i = new Set(
      s.include && s.include.length > 0
        ? s.include
        : ["summary", "headers", "initiator", "body"],
    ),
    c = e.getNetworkDetails(),
    u =
      i.has("headers") || i.has("initiator") || i.has("body")
        ? c[r.id]
        : void 0,
    o,
    d,
    a = !1,
    l;
  if (i.has("body") || s.jsonPath) {
    let f = e.getNetworkBody(r);
    if (f !== void 0)
      if (
        ((r.status ?? 0) >= 200 && (r.status ?? 0) < 300 && (l = dn(f)),
        s.jsonPath)
      )
        try {
          let m = JSON.parse(f);
          d = se(m, s.jsonPath);
        } catch (m) {
          let p = m instanceof Error ? m.message : String(m);
          throw new Error(
            `INVALID_RESPONSE_JSON: Cannot evaluate jsonPath "${s.jsonPath}" because response body is not valid JSON (${p})`,
          );
        }
      else {
        let m = s.bodyMaxChars ?? 8e3;
        f.length > m ? ((o = f.slice(0, m)), (a = !0)) : (o = f);
      }
  }
  return {
    entry: r,
    relativeMs: e.toRelativeMs(r.createdAt),
    details: u,
    bodyText: o,
    extractedJson: d,
    bodyTruncated: a,
    bizError: l,
  };
}
function pe(e) {
  if (typeof e == "string") return e.length > 0 ? e : void 0;
  if (e && typeof e == "object") {
    if ("text" in e && typeof e.text == "string") {
      let t = e.text;
      return t.length > 0 ? t : void 0;
    }
    try {
      let t = JSON.stringify(e);
      if (t && t !== "{}" && t !== "[]") return t;
    } catch {}
  }
}
function pn(e, t, s) {
  let n = e?.request,
    r =
      pe(t?.requestBody) ??
      pe(t?.postData) ??
      pe(e?.requestBody) ??
      pe(e?.postData) ??
      pe(n?.postData) ??
      pe(n?.body);
  if (r !== void 0) return r;
  if (!s) return;
  let i = typeof n?.bodyHash == "string" ? n.bodyHash : void 0,
    c = t?.requestBodyBlob;
  return s.resolveBlobTextByHash(i ?? c?.hash, c?.path);
}
function Gs(e, t = 4e3) {
  let s = e.trim();
  if (
    (s.startsWith("{") && s.endsWith("}")) ||
    (s.startsWith("[") && s.endsWith("]"))
  )
    try {
      let n = JSON.parse(s),
        r = JSON.stringify(n, null, 2);
      return r.length <= t
        ? r
        : r.slice(0, t) +
            `
\u2026 [JSON request body truncated at ${t} chars]`;
    } catch {}
  return e.length > t
    ? e.slice(0, t) +
        `
\u2026 [Request body truncated at ${t} chars]`
    : e;
}
function mn(e) {
  let t = M(e.pack);
  if (t.kind !== "session")
    throw new Error(
      `UNSUPPORTED_PACK_KIND: get_request requires a session evidence pack, but "${e.pack}" is a screenshot pack.`,
    );
  let s = hn(t, e.id, {
    include: e.include,
    jsonPath: e.jsonPath,
    bodyMaxChars: e.bodyMaxChars,
  });
  if (e.format === "json") {
    let a = pn(s.entry, s.details, t),
      l = { ...s, resolvedRequestBody: a };
    return w(JSON.stringify(l, null, 2), e.maxChars);
  }
  let { entry: n, details: r } = s,
    i = z(t),
    c = i && n.response?.bodyPath ? `${i}/${n.response.bodyPath}` : void 0,
    u = new Set(
      e.include && e.include.length > 0
        ? e.include
        : ["summary", "headers", "initiator", "body"],
    ),
    o = [];
  if (
    (u.has("summary") &&
      (o.push(`# Request \`${n.id}\` (${n.method ?? "GET"} ${n.status ?? 0})`),
      o.push(`- **URL**: ${n.url}`),
      o.push(
        `- **Time**: ${I(s.relativeMs)} | Duration: ${Y(n.durationMs)} | Type: ${n.type ?? "\u2014"}`,
      ),
      o.push(
        `- **Response Info**: mimeType=${n.response?.mimeType ?? "\u2014"}, bodyStatus=${n.response?.bodyStatus ?? "\u2014"}, byteLength=${n.response?.byteLength ?? "\u2014"}, bodyPath=${c ? `\`${c}\`` : (n.response?.bodyPath ?? "inline/none")}`,
      ),
      n.errorText && o.push(`- **Error**: ${n.errorText}`)),
    u.has("headers"))
  ) {
    let a = r?.requestHeaders ?? n.request?.headers,
      l = r?.responseHeaders ?? n.response?.headers;
    (a &&
      Object.keys(a).length > 0 &&
      (o.push(`
## Request Headers`),
      o.push(JSON.stringify(a, null, 2))),
      l &&
        Object.keys(l).length > 0 &&
        (o.push(`
## Response Headers`),
        o.push(JSON.stringify(l, null, 2))));
  }
  if (u.has("body") || u.has("headers")) {
    let a = pn(n, r, t);
    a !== void 0 &&
      (o.push(`
## Request Body`),
      o.push(Gs(a, 4e3)));
  }
  if (
    (u.has("initiator") &&
      r?.initiator &&
      (o.push(`
## Initiator`),
      o.push(JSON.stringify(r.initiator, null, 2).slice(0, 3e3))),
    e.jsonPath !== void 0)
  )
    (o.push(`
## Extracted Response Body (jsonPath: \`${e.jsonPath}\`)`),
      o.push(JSON.stringify(s.extractedJson, null, 2)));
  else if (u.has("body")) {
    if (
      (o.push(`
## Response Body`),
      s.bodyText === void 0)
    )
      o.push("(No response body captured for this entry)");
    else if ((o.push(s.bodyText), s.bodyTruncated)) {
      let a =
          !c && i && n.response?.bodyHash
            ? `${i}/network/blobs/${n.response.bodyHash.replace(/^sha256:/i, "").slice(0, 16)}.bin`
            : void 0,
        l =
          c ??
          a ??
          (i
            ? `${i}/${t.files.has("session-data.json") ? "session-data.json" : "data/session-data.json"}`
            : void 0),
        f = l ? ` Or query \`${l}\` directly with \`jq\` / \`read_file\`.` : "";
      o.push(`
\u2026 [Response body truncated at ${e.bodyMaxChars ?? 8e3} chars. Pass \`jsonPath\` (e.g. "data.definition.form.elements[id=ssd_a]") or a higher \`bodyMaxChars\` to inspect further.${f}]`);
    }
  }
  return w(
    o.join(`
`),
    e.maxChars,
  );
}
function gn(e) {
  let t = M(e.pack),
    s = e.sceneId ?? (e.sceneIndex !== void 0 ? String(e.sceneIndex) : void 0);
  if (t.kind === "screenshot") {
    let p = t.domContext?.anchors ?? [],
      h = p.map((x) => x.intentFlags?.textComment).filter(Boolean),
      $ = Fe(t.domContext),
      g = e.selector ?? s,
      S = [
        {
          type: "text",
          text:
            e.format === "json"
              ? w(
                  JSON.stringify(
                    {
                      kind: "screenshot",
                      smallestCommonAncestorSelector:
                        t.domContext?.smallestCommonAncestorSelector,
                      textComments: h,
                      deviations: $,
                      anchors: g
                        ? p.filter((x, k) =>
                            `${k} ${x.selector ?? ""} ${x.selectorPath ?? ""} ${x.componentName ?? ""} ${x.innerText ?? ""}`
                              .toLowerCase()
                              .includes(g.toLowerCase()),
                          )
                        : p,
                      screenshotPath: t.getScreenshotImagePath(),
                    },
                    null,
                    2,
                  ),
                  e.maxChars,
                )
              : w(
                  [
                    "# Screenshot Scene, DOM Anchors & CSS Cascade",
                    `- **Text Annotations**: ${h.length > 0 ? h.join(" | ") : "(none \u2014 expectation must be treated as inferred hypothesis)"}`,
                    `- **Smallest Common Ancestor**: \`${t.domContext?.smallestCommonAncestorSelector ?? "\u2014"}\``,
                    ...($.length > 0
                      ? [
                          `
## Auto-Detected Layout/Overflow Deviations (${$.length})`,
                          ...$.map(
                            (x) =>
                              `- \u26A0\uFE0F **[${x.kind}] \`${x.selectorPath ?? x.selector}\`** (anchors: [${x.anchorIndices.slice(0, 6).join(",")}]) \u2014 ${x.summary}${x.keyStyles ? ` | styles=${JSON.stringify(x.keyStyles)}` : ""}`,
                          ),
                        ]
                      : []),
                    "",
                    ...Le(t.domContext, t.cascade, {
                      selector: g,
                      cssProperty: e.cssProperty,
                    }),
                  ].join(`
`),
                  e.maxChars,
                ),
        },
      ],
      y = t.getScreenshotImagePath();
    return (
      (e.includeImage ?? !0) &&
        y &&
        S.push(...F(t, y, "Screenshot pack image")),
      S
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
  let r = s ? n.find((p) => p.id === s || String(p.index) === s) : n[0];
  if (!r) {
    let p = n.map((h) => `${h.index}:${h.id}`).join(", ");
    throw new Error(
      `SCENE_NOT_FOUND: Scene "${s ?? e.sceneId}" not found. Available scenes: [${p}]`,
    );
  }
  let { scene: i } = r,
    c = i.narrative?.expected,
    u = typeof c == "string" ? c : c?.text,
    o =
      typeof c == "object" && c !== null
        ? (c.confidence ?? "missing")
        : u
          ? "explicit"
          : "missing",
    d =
      i.targets && i.targets.length > 0
        ? i.targets
        : i.target
          ? [i.target]
          : [],
    a;
  if (e.format === "json")
    a = w(
      JSON.stringify(
        {
          id: r.id,
          index: r.index,
          relativeMs: t.toRelativeMs(
            i.selectionStartedAtEpochMs ?? i.observedAtEpochMs,
          ),
          narrative: {
            actual: i.narrative?.actual ?? null,
            expected: u ?? null,
            confidence: o,
            confidenceNotice:
              o === "missing"
                ? "UNCAPTURED_EXPECTATION: User expectation was not captured. Any expectation you formulate MUST be explicitly declared as an inferred hypothesis."
                : void 0,
          },
          sequenceContextNotice:
            "RAW_SAME_TIME_CONTEXT_ONLY: sequenceContext lists events near the mark moment and MUST NOT be treated as a proven causal chain.",
          sequenceContext: i.sequenceContext,
          targets: d,
          annotation: i.annotation,
          originalSource: r.originalSource,
          annotatedSource: r.annotatedSource,
        },
        null,
        2,
      ),
      e.maxChars,
    );
  else {
    let p = [],
      h = t.toRelativeMs(i.selectionStartedAtEpochMs ?? i.observedAtEpochMs);
    (p.push(`# Issue Scene [${r.index}] \`${r.id}\` (at ${I(h)})`),
      p.push(`
## 1. Narrative & Expectation Anchor`),
      p.push(`- **actual**: ${i.narrative?.actual || "(empty)"}`),
      p.push(`- **expected** [confidence: \`${o}\`]: ${u || "(missing)"}`),
      (o === "missing" || !u) &&
        p.push(
          "  > \u26A0\uFE0F **UNCAPTURED EXPECTATION**: You MUST explicitly state that the expected behavior was not captured and mark any inferred expectation as a hypothesis.",
        ),
      p.push(`
## 2. Selected DOM Targets (${d.length})`));
    for (let [g, v] of d.entries()) {
      let S = gt(v.element, 80),
        y = (v.ancestors ?? [])
          .slice(0, 6)
          .map((x) => {
            let k = x.id ? `#${x.id}` : "",
              b =
                x.classNames && x.classNames.length > 0
                  ? `.${x.classNames.slice(0, 2).join(".")}`
                  : "";
            return `${x.tagName ?? "div"}${k}${b}`;
          })
          .join(" <- ");
      (p.push(`- **Target #${g}**: ${S}`),
        y && p.push(`  - **Ancestors**: ${y}`),
        v.sanitizedHtml &&
          p.push(`  - **sanitizedHtml**: \`${v.sanitizedHtml.slice(0, 600)}\``),
        v.computedStyle &&
          Object.keys(v.computedStyle).length > 0 &&
          p.push(`  - **computedStyle**: ${JSON.stringify(v.computedStyle)}`),
        v.state &&
          Object.keys(v.state).length > 0 &&
          p.push(`  - **state**: ${JSON.stringify(v.state)}`),
        v.triggerElement &&
          p.push(
            `  - **triggerElement (Portal Host)**: \`${v.triggerElement.selectorPath ?? v.triggerElement.tagName ?? "?"}\`${v.triggerElement.componentName ? ` (component: \`${v.triggerElement.componentName}\`)` : ""}`,
          ),
        v.relatedOverlays &&
          v.relatedOverlays.length > 0 &&
          p.push(
            `  - **relatedOverlays**: ${v.relatedOverlays.map((x) => `${x.tagName ?? "div"}${x.id ? `#${x.id}` : ""} (${x.relationReason ?? "linked"})`).join(", ")}`,
          ));
    }
    (r.domStylesPath || r.domContextPath) &&
      p.push(`
- **Schema v5 Artifacts**: ${r.domContextPath ? `\`${r.domContextPath}\`` : ""}${r.domStylesPath ? ` \`${r.domStylesPath}\` (inspect winner CSS via \`get_css --scene ${r.index}\`)` : ""}`);
    let $ = i.sequenceContext;
    if (
      (p.push(`
## 3. Sequence Context (Raw Same-Time Context \u2014 NOT Proven Causality)`),
      !$)
    )
      p.push("(No sequenceContext recorded)");
    else {
      let g = $.interactions ?? [],
        v = $.consoleErrors ?? [],
        S = $.networkFailures ?? [];
      p.push(
        `Window: ${$.windowMs ?? 6e4}ms before anchor | ${g.length} interactions, ${v.length} console errors, ${S.length} network failures`,
      );
      for (let y of g.slice(-15))
        p.push(
          `  - [${y.offsetMs ?? 0}ms] [${y.kind}] <${y.tagName ?? "?"}> text="${y.text ?? ""}" ${y.value !== void 0 ? `val="${y.value}"` : ""}`,
        );
      for (let y of v)
        p.push(
          `  - [${y.offsetMs ?? 0}ms] [CONSOLE ${y.level ?? "ERROR"}] ${y.text ?? ""}`,
        );
      for (let y of S)
        p.push(
          `  - [${y.offsetMs ?? 0}ms] [NET ${y.method ?? "GET"} ${y.status ?? "ERR"}] ${y.url ?? ""}`,
        );
    }
    a = w(
      p.join(`
`),
      e.maxChars,
    );
  }
  let l = [{ type: "text", text: a }],
    f = e.includeImage ?? !0,
    m = r.annotatedSource ?? r.originalSource;
  return (f && m && l.push(...F(t, m, `Scene [${r.index}] screenshot`)), l);
}
function yn(e) {
  let t = M(e.pack);
  if (t.kind === "screenshot") {
    let c = t.getScreenshotImagePath();
    if (!c)
      throw new Error(
        `SCREENSHOT_NOT_FOUND: No screenshot image found in screenshot pack "${e.pack}".`,
      );
    return F(t, c, "Screenshot pack image");
  }
  let s = e.final
    ? "final"
    : e.settled
      ? "settled"
      : (e.kind ?? (e.step !== void 0 ? "step" : "issue-annotated"));
  if (s === "final") {
    let c = [];
    t.data.summary?.finalFramePath && c.push(t.data.summary.finalFramePath);
    for (let o of ["jpg", "png", "jpeg", "webp"])
      c.push(`screenshots/final-frame.${o}`);
    for (let o of c)
      if (t.files.has(o)) {
        let d = t.data.summary?.durationMs,
          a = d
            ? `Final frame before stop (+${d}ms)`
            : "Final frame before stop";
        return F(t, o, a);
      }
    let u = Array.from(t.files.keys())
      .filter((o) => o.startsWith("screenshots/"))
      .slice(0, 15)
      .join(", ");
    throw new Error(
      `FINAL_FRAME_NOT_FOUND: Final frame screenshot (screenshots/final-frame.*) was not found in pack. Available screenshots: [${u}]`,
    );
  }
  if (s === "settled") {
    let c = e.step ?? 1,
      u = t.getInteractions()[c - 1],
      o = u?.screenshots?.settledDurationMs ?? u?.screenshot?.settledDurationMs,
      d = [];
    u?.screenshots?.settledPath && d.push(u.screenshots.settledPath);
    for (let l of ["jpg", "png", "jpeg", "webp"])
      d.push(`screenshots/step-${c}-settled.${l}`);
    for (let l of d)
      if (t.files.has(l)) {
        let f = typeof o == "number" ? `, settled in ${o}ms` : "";
        return F(t, l, `Step ${c} settled screenshot${f}`);
      }
    let a = Array.from(t.files.keys())
      .filter((l) => /^screenshots\/step-\d+-settled\./.test(l))
      .slice(0, 15)
      .join(", ");
    throw new Error(
      `SETTLED_SCREENSHOT_NOT_FOUND: Settled screenshot for step ${c} not found. Available settled frames: [${a}]`,
    );
  }
  if (s === "step") {
    let c = e.step ?? 1;
    for (let o of ["jpg", "png", "jpeg", "webp"]) {
      let d = `screenshots/step-${c}.${o}`;
      if (t.files.has(d)) {
        let a = t.data.screenshotSummaries?.find((f) => f.step === c),
          l = a
            ? `Step ${c} screenshot (+${a.elapsedMs ?? 0}ms [${a.kind ?? "?"}] ${a.element ?? ""})`
            : `Step ${c} screenshot`;
        return F(t, d, l);
      }
    }
    let u = Array.from(t.files.keys())
      .filter((o) => o.startsWith("screenshots/step-"))
      .slice(0, 15)
      .join(", ");
    throw new Error(
      `STEP_SCREENSHOT_NOT_FOUND: Screenshot for step ${c} not found. Available sample: [${u}]`,
    );
  }
  let n = t.getIssueScenes();
  if (n.length === 0)
    throw new Error(
      'SCENE_SCREENSHOT_NOT_FOUND: Pack has no issueScenes. Use kind="step" with step=1..N to inspect interaction screenshots.',
    );
  let r = e.sceneId
    ? n.find((c) => c.id === e.sceneId || String(c.index) === e.sceneId)
    : n[0];
  if (!r)
    throw new Error(`SCENE_NOT_FOUND: Scene "${e.sceneId}" not found in pack.`);
  let i =
    s === "issue-original"
      ? (r.originalSource ?? r.annotatedSource)
      : (r.annotatedSource ?? r.originalSource);
  if (!i)
    throw new Error(
      `SCENE_IMAGE_MISSING: Scene "${r.id}" does not have a ${s} image file.`,
    );
  return F(t, i, `Scene [${r.index}] (${r.id}) ${s}`);
}
import { existsSync as $t } from "node:fs";
import { join as vn, resolve as Je } from "node:path";
import { createHash as Ks } from "node:crypto";
function Xs(e) {
  return e
    ? e
        .replace(
          /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
          "[UUID]",
        )
        .replace(/\b1[6-9]\d{11}\b/g, "[TIMESTAMP]")
        .replace(
          /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/gi,
          "[TIMESTAMP]",
        )
        .replace(/\b\d+(?:\.\d+)?\s*(?:ms|s)\b/gi, "[DURATION]")
        .replace(/\b0x[0-9a-fA-F]+\b/g, "[HEX]")
        .trim()
        .slice(0, 500)
    : "";
}
function Zs(e) {
  let t = (e.level || "log").toLowerCase().replace("warning", "warn"),
    s = e.sourceMapped ?? e.location ?? "",
    n = Xs(e.text),
    r = `${t}:${s}:${n}`;
  return Ks("sha256").update(r).digest("hex").slice(0, 12);
}
function Vs(e, t) {
  return typeof e == "string" && e.trim()
    ? e
    : Array.isArray(e) && e.length > 0
      ? e.map((s) => {
          let n = s.functionName || "<anonymous>",
            r = s.sourceMappedLocation,
            i =
              r?.resolved && r.originalFile
                ? `${r.originalFile}:${r.originalLine ?? 0}`
                : `${s.url ?? "?"}:${s.lineNumber ?? 0}`;
          return `at ${n} (${i})`;
        }).join(`
`)
      : t;
}
function xt(e) {
  if (typeof e != "number" || !Number.isFinite(e)) return "\u2014";
  let t = Math.round(e);
  return `${t >= 0 ? "+" : "-"}${Math.abs(t)}ms`;
}
function qe(e, t = {}) {
  let s = e.getConsoleEntries(),
    n =
      t.levels && t.levels.length > 0
        ? new Set(
            t.levels.flatMap((l) => {
              let f = l.toLowerCase();
              return f === "warn" || f === "warning"
                ? ["warn", "warning"]
                : [f];
            }),
          )
        : void 0,
    r = t.search?.toLowerCase(),
    i = t.regex ? new RegExp(t.regex, "i") : void 0,
    c = [];
  s.forEach((l, f) => {
    let m = (l.level ?? "log").toLowerCase();
    if (n && !n.has(m)) return;
    let p = e.toRelativeMs(l.createdAt),
      h = e.toRelativeMs(l.lastCreatedAt) ?? p;
    if (
      (t.fromMs !== void 0 && (h === void 0 || h < t.fromMs)) ||
      (t.toMs !== void 0 && (p === void 0 || p > t.toMs))
    )
      return;
    let $ = l.text ?? "",
      g = l.url ?? l.source ?? "",
      v = Vs(l.stackTrace, l.stack),
      S = `${$}
${g}
${v ?? ""}`;
    if ((r && !S.toLowerCase().includes(r)) || (i && !i.test(S))) return;
    let y = g
        ? `${g}${l.lineNumber !== void 0 ? `:${l.lineNumber}` : ""}`
        : void 0,
      x = l.sourceMappedLocation,
      k = x?.originalFunctionName ?? x?.originalName,
      b =
        x?.resolved && x.originalFile
          ? `${x.originalFile}:${x.originalLine ?? 0}${x.originalColumn !== void 0 ? `:${x.originalColumn}` : ""}${k ? ` (${k})` : ""}`
          : void 0,
      P =
        l.summarySignature ??
        Zs({ level: m, location: y, sourceMapped: b, text: $ });
    c.push({
      entry: l,
      index: f,
      relMs: p,
      lastRelMs: h,
      repeatCount: Math.max(1, l.repeatCount ?? 1),
      level: m,
      text: $,
      loc: y,
      sourceMapped: b,
      stackStr: v,
      signature: P,
    });
  });
  let u = [],
    o = new Map();
  for (let l of c)
    o.set(l.signature, (o.get(l.signature) ?? 0) + l.repeatCount);
  if (t.unfold) {
    u = [];
    for (let l of c) {
      let f = l.entry.summaryTimestamps;
      if (l.repeatCount > 1 && Array.isArray(f) && f.length > 0)
        for (let m of f) {
          let p = e.toRelativeMs(m) ?? l.relMs ?? 0;
          u.push({
            index: l.index,
            id: l.entry.id,
            relativeMs: p,
            level: l.level,
            text: l.text,
            location: l.loc,
            sourceMapped: l.sourceMapped,
            stack: l.stackStr,
            count: 1,
            firstRelativeMs: p,
            lastRelativeMs: p,
            timeRangeMs: [p, p],
            signature: l.signature,
          });
        }
      else {
        let m = l.relMs ?? 0,
          p = l.lastRelMs ?? m;
        u.push({
          index: l.index,
          id: l.entry.id,
          relativeMs: l.relMs,
          level: l.level,
          text: l.text,
          location: l.loc,
          sourceMapped: l.sourceMapped,
          stack: l.stackStr,
          count: l.repeatCount,
          firstRelativeMs: m,
          lastRelativeMs: p,
          timeRangeMs: [m, p],
          signature: l.signature,
        });
      }
    }
  } else {
    let l = new Map();
    for (let f of c) {
      let m = f.relMs ?? 0,
        p = f.lastRelMs ?? m,
        h = l.get(f.signature);
      h
        ? ((h.count += f.repeatCount),
          m < h.firstRelativeMs && (h.firstRelativeMs = m),
          p > h.lastRelativeMs && (h.lastRelativeMs = p),
          (h.timeRangeMs = [h.firstRelativeMs, h.lastRelativeMs]),
          !h.stack && f.stackStr && (h.stack = f.stackStr),
          !h.sourceMapped &&
            f.sourceMapped &&
            (h.sourceMapped = f.sourceMapped))
        : l.set(f.signature, {
            index: f.index,
            id: f.entry.id,
            relativeMs: f.relMs,
            level: f.level,
            text: f.text,
            location: f.loc,
            sourceMapped: f.sourceMapped,
            stack: f.stackStr,
            count: f.repeatCount,
            firstRelativeMs: m,
            lastRelativeMs: p,
            timeRangeMs: [m, p],
            signature: f.signature,
          });
    }
    u = Array.from(l.values());
  }
  if (t.minCount !== void 0 && t.minCount > 1) {
    let l = t.minCount;
    t.unfold
      ? (u = u.filter((f) => (o.get(f.signature ?? "") ?? f.count) >= l))
      : (u = u.filter((f) => f.count >= l));
  }
  let d = Math.max(0, t.offset ?? 0),
    a = Math.max(1, t.limit ?? 50);
  return {
    totalEntries: e.getConsoleTotalCount(),
    matchedCount: u.length,
    folded: !t.unfold,
    offset: d,
    limit: a,
    items: u.slice(d, d + a),
  };
}
function Ue(e, t = {}) {
  let s = (e.level ?? "log").toUpperCase(),
    n = s === "WARNING" ? "WARN" : s,
    r = e.count ?? 1,
    i = e.firstRelativeMs ?? e.relativeMs ?? 0,
    c = e.lastRelativeMs ?? i,
    u = "";
  t.unfold || r <= 1
    ? (u = `[x1 time | ${xt(i)}]`)
    : (u = `[x${r} times | ${xt(i)}..${xt(c)}]`);
  let d = `[#${String(e.index).padStart(3, "0")}] [${n}] ${u} ${e.text}`,
    a = "       ";
  if (
    (e.sourceMapped
      ? (d += `
${a}sourceMapped: ${e.sourceMapped}`)
      : e.location &&
        (d += `
${a}location: ${e.location}`),
    e.stack)
  ) {
    let l = e.stack
      .split(
        `
`,
      )
      .map((f) => f.trim())
      .filter((f) => f.length > 0)
      .slice(0, 5);
    if (l.length > 0) {
      d += `
${a}stack: ${l[0]}`;
      for (let f = 1; f < l.length; f++)
        d += `
${a}       ${l[f]}`;
    }
  }
  return d;
}
function Qs(e, t, s) {
  let n = e.data.summary,
    r = e.getIssueScenes(),
    i = qe(e, { levels: ["error"], limit: 5 }),
    c = De(e, { status: "failed", limit: 5 }),
    u = e.listFiles(),
    o = z(e),
    d = o && $t(vn(o, X)) ? Je(o, X) : void 0,
    a = o
      ? Te.map((g) => Je(o, ...g.target.split("/"))).filter((g) => $t(g))
      : [],
    l = o
      ? Array.from(e.skippedMediaFiles.keys()).map((g) =>
          Je(o, ...g.split("/")),
        )
      : [];
  if (t === "json") {
    let g = {
      kind: "session",
      packPath: e.packPath,
      workspaceDir: o,
      indexPath: d,
      derivedJsonFiles: a,
      recordingPaths: l,
      sessionId: e.sessionId,
      packMode: e.manifest?.packMode,
      casStats: e.manifest?.casStats,
      integrity: e.integrity,
      summary: n,
      issueScenes: r.map((v) => {
        let S = v.scene.narrative?.expected,
          y = typeof S == "string" ? S : S?.text,
          x =
            typeof S == "object" && S !== null
              ? (S.confidence ?? "missing")
              : y
                ? "explicit"
                : "missing";
        return {
          id: v.id,
          index: v.index,
          actual: v.scene.narrative?.actual ?? null,
          expected: y ?? null,
          expectedConfidence: x,
          originalSource: v.originalSource,
          annotatedSource: v.annotatedSource,
        };
      }),
      topConsoleErrors: i.items,
      topNetworkFailures: c.items,
      filesCount: u.length,
      files: u,
    };
    return w(JSON.stringify(g, null, 2), s);
  }
  let f = [];
  if (
    (e.integrity.schemaWarning &&
      f.push(`\u26A0\uFE0F ${e.integrity.schemaWarning}
`),
    e.integrity.valid ||
      f.push(`\u26A0\uFE0F Integrity check reported mismatches: ${e.integrity.mismatches.join("; ")}
`),
    f.push("# Bug Lens Evidence Pack (kind: session)"),
    o && f.push(`- **Workspace**: \`${o}\``),
    d &&
      f.push(
        `- **Index**: \`${d}\` (read this file for full schema, request->body map, and jq recipes)`,
      ),
    a.length > 0 &&
      f.push(`- **Derived JSON**: ${a.map((g) => `\`${g}\``).join(", ")}`),
    l.length > 0 &&
      f.push(`- **Recording**: ${l.map((g) => `\`${g}\``).join(", ")}`),
    f.push(`- **Session ID**: \`${e.sessionId}\``),
    f.push(
      `- **Schema**: v${e.integrity.schemaVersion ?? e.data.session?.schemaVersion ?? "?"} (integrity: ${e.integrity.valid ? "OK" : "MISMATCH"}, checked ${e.integrity.checkedCount} files)`,
    ),
    f.push(
      `- **Page**: ${n?.title ?? e.data.session?.target?.initialTitle ?? "\u2014"} (${n?.url ?? e.data.session?.target?.initialUrl ?? "\u2014"})`,
    ),
    f.push(
      `- **Duration**: ${Y(n?.durationMs ?? e.data.session?.timeline?.durationMs)} | Quality: ${n?.quality ?? "\u2014"} | Privacy: ${n?.privacyMode ?? "\u2014"}`,
    ),
    n?.environment)
  ) {
    let g = n.environment;
    f.push(
      `- **Environment**: ${g.os ?? "?"} \xB7 ${g.browser ?? "?"} \xB7 ${g.language ?? "?"} \xB7 screen ${g.screen ?? "?"} \xB7 viewport ${g.viewport ?? "?"}`,
    );
  }
  if (
    (f.push(
      `- **Counts**: ${e.getInteractions().length} interactions | ${e.getConsoleTotalCount()} console entries (${i.matchedCount} unique error signatures) | ${e.getNetworkEntries().length} network requests (${c.matchedCount} failed) | ${r.length} issue scenes | ${e.getFrameworkStates().length} framework snapshots`,
    ),
    f.push(`
## Issue Scenes (${r.length})`),
    r.length === 0)
  )
    f.push("(No issue scenes marked in this session)");
  else
    for (let g of r) {
      let v = e.toRelativeMs(
          g.scene.selectionStartedAtEpochMs ?? g.scene.observedAtEpochMs,
        ),
        S = g.scene.narrative?.expected,
        y = typeof S == "string" ? S : S?.text,
        x =
          typeof S == "object" && S !== null
            ? (S.confidence ?? "missing")
            : y
              ? "explicit"
              : "missing";
      (f.push(`- **Scene [${g.index}] \`${g.id}\`** (at ${I(v)}):`),
        f.push(`  - **actual**: ${g.scene.narrative?.actual || "(empty)"}`),
        f.push(
          `  - **expected** [confidence=${x}]: ${y || "(not captured \u2014 treat any expectation as inferred hypothesis)"}`,
        ),
        f.push(
          `  - **screenshots**: annotated=\`${g.annotatedSource ?? "none"}\`, original=\`${g.originalSource ?? "none"}\``,
        ));
      let k = g.annotatedSource ?? g.originalSource;
      if (k) {
        let b = _e(e, k);
        b &&
          f.push(
            `  - **savedImagePath**: \`${b}\` (call \`read_file\` on this path to view the scene screenshot)`,
          );
      }
    }
  if (
    (f.push(`
## Top Console Errors (${i.matchedCount} total)`),
    i.items.length === 0)
  )
    f.push("(No console errors recorded)");
  else for (let g of i.items) f.push(`- ${Ue(g)}`);
  if (
    (f.push(`
## Top Failed Network Requests (${c.matchedCount} total)`),
    c.items.length === 0)
  )
    f.push("(No failed network requests recorded)");
  else for (let g of c.items) f.push(`- ${ze(g)}`);
  f.push(`
## Package Files (${u.length})`);
  let m = u.filter(
      (g) =>
        !g.path.startsWith("screenshots/") &&
        !g.path.startsWith("network/body-"),
    ),
    p = u.filter((g) => g.path.startsWith("network/body-")).length,
    h = u.filter((g) => g.path.startsWith("screenshots/")).length;
  for (let g of m)
    f.push(
      `- \`${g.path}\` (${g.byteLength} B${g.skippedMedia ? ", extracted on disk" : ""})`,
    );
  (p > 0 && f.push(`- \`network/body-*.txt\` (${p} split body files)`),
    h > 0 && f.push(`- \`screenshots/step-*.*\` (${h} step screenshots)`));
  let $ = e.files.has("session-data.json")
    ? "session-data.json"
    : "data/session-data.json";
  return (
    f.push(`
**Next steps** (active pack is extracted & cached; omit \`--pack\` in subsequent commands): Run \`get_scene\` to inspect DOM targets & annotated screenshot, \`timeline --windowMs 15000\` for chronological events around the issue, \`query_network --status failed\` / \`get_request <id> --jsonPath "..."\` for API bodies, \`get_framework_state\` for Vue/React state, or read \`INDEX.md\` and query \`${$}\` / \`network/*\` directly with \`jq\`.`),
    w(
      f.join(`
`),
      s,
    )
  );
}
function Ys(e, t, s) {
  let n = e.domContext,
    r = n?.anchors ?? [],
    i = e.listFiles(),
    c = z(e),
    u = c && $t(vn(c, X)) ? Je(c, X) : void 0;
  if (t === "json")
    return w(
      JSON.stringify(
        {
          kind: "screenshot",
          packPath: e.packPath,
          workspaceDir: c,
          indexPath: u,
          screenshotPath: e.getScreenshotImagePath(),
          environment: e.environment,
          smallestCommonAncestorSelector: n?.smallestCommonAncestorSelector,
          meta: n?.meta,
          anchors: r.map((h) => ({
            selector: h.selector,
            selectorPath: h.selectorPath,
            tagName: h.tagName,
            componentName: h.componentName,
            componentFile: h.componentFile,
            intentFlags: h.intentFlags,
            innerText: h.innerText?.slice(0, 120),
          })),
          hasCascade: !!e.cascade,
          files: i,
        },
        null,
        2,
      ),
      s,
    );
  let o = [],
    d = e.environment,
    a = d?.recentConsoleErrors ?? [],
    l = d?.recentFailedRequests ?? [],
    f = d?.frameworkComponentStates ?? d?.vueComponentStates ?? [],
    m = e.getScreenshotImagePath(),
    p = m ? _e(e, m) : void 0;
  if (
    (o.push("# Bug Lens Screenshot Pack (kind: screenshot)"),
    c && o.push(`- **Workspace**: \`${c}\``),
    u && o.push(`- **Index**: \`${u}\``),
    o.push(
      `- **Image**: \`${m ?? "none"}\`${p ? ` -> Saved to \`${p}\` (call \`read_file\` on this path to inspect visually)` : ""}`,
    ),
    d &&
      (o.push(`- **Page**: ${d.title ?? "\u2014"} (${d.url ?? "\u2014"})`),
      o.push(
        `- **Viewport**: ${d.viewport?.width ?? "?"}x${d.viewport?.height ?? "?"} (${d.mediaBreakpoint ?? "?"}) | UA: ${d.userAgent ?? "\u2014"}`,
      ),
      o.push(
        `- **Anomalies & State**: ${a.length} recent console error(s) | ${l.length} failed request(s) | ${f.length} component state snapshot(s)`,
      )),
    n)
  ) {
    o.push(
      `- **DOM Context**: SCA=\`${n.smallestCommonAncestorSelector ?? "?"}\` | anchors=${n.meta?.anchorCount ?? r.length}, leaves=${n.meta?.leafCount ?? n.leaves?.length ?? 0}, ancestors=${n.meta?.ancestorCount ?? n.ancestors?.length ?? 0}`,
    );
    let h = Fe(n);
    if (h.length > 0) {
      o.push(`
## Layout & Overflow Diagnostics (${h.length} distinct issue group(s))`);
      for (let v of h) {
        let S =
            v.anchorIndices.length > 0
              ? ` (anchors: [${v.anchorIndices.slice(0, 6).join(", ")}${v.anchorIndices.length > 6 ? `, ... (${v.anchorIndices.length} total)` : ""}])`
              : "",
          y = v.component ? ` [${v.component}]` : "";
        (o.push(
          `- \u26A0\uFE0F **[${v.kind}] \`${v.selectorPath ?? v.selector}\`**${y}${S}: ${v.summary}`,
        ),
          v.sampleText && o.push(`  - sampleText: "${v.sampleText}"`),
          v.keyStyles &&
            o.push(`  - keyComputedStyles: ${JSON.stringify(v.keyStyles)}`));
      }
    }
    o.push(`
## Annotated DOM Anchors (${r.length})`);
    let $ = new Map(),
      g = [];
    r.forEach((v, S) => {
      let y = `${v.selectorPath ?? v.selector ?? "?"}|${v.componentName ?? ""}|${JSON.stringify(v.intentFlags ?? {})}`,
        x = $.get(y);
      x ? x.push(S) : ($.set(y, [S]), g.push({ idx: S, anchor: v, sig: y }));
    });
    for (let { idx: v, anchor: S, sig: y } of g.slice(0, 15)) {
      let x = $.get(y) ?? [v],
        k =
          x.length > 1
            ? ` (+${x.length - 1} siblings: [${x.slice(1, 5).join(",")}${x.length > 5 ? ",..." : ""}])`
            : "",
        b = [];
      (S.intentFlags?.isArrowTarget && b.push("arrow"),
        S.intentFlags?.isHighlightedFocus && b.push("focus"),
        S.intentFlags?.textComment &&
          b.push(`comment="${S.intentFlags.textComment}"`));
      let P = b.length > 0 ? ` [${b.join(",")}]` : "",
        R = S.componentName
          ? ` [${S.componentName}${S.componentFile ? ` @ ${S.componentFile}${S.componentLine ? `:${S.componentLine}` : ""}` : ""}]`
          : "",
        ee = S.selectorPath ?? S.selector ?? "?",
        T = ee.length > 75 ? `\u2026${ee.slice(-72)}` : ee,
        me = (S.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 50);
      o.push(`- [${v}] \`${T}\`${R}${P}${k}${me ? ` text="${me}"` : ""}`);
    }
    g.length > 15 &&
      o.push(
        `- ... +${g.length - 15} more unique anchors (use \`get_scene(selector="...")\` to filter)`,
      );
  }
  if ((e.cascade && o.push(...an(e.cascade)), a.length > 0)) {
    o.push(`
## Recent Console Errors (${a.length})`);
    for (let [h, $] of a.slice(0, 5).entries())
      o.push(`- [#${h}] ${$.message ?? ""}`);
  }
  if (l.length > 0) {
    o.push(`
## Recent Failed Network Requests (${l.length})`);
    for (let h of l.slice(0, 5))
      o.push(`- ${h.method ?? "GET"} ${h.status ?? 0} ${h.url ?? ""}`);
  }
  o.push(`
## Files (${i.length})`);
  for (let h of i) o.push(`- \`${h.path}\` (${h.byteLength} B)`);
  return (
    o.push(
      '\n**Next steps** (active pack is cached; omit `--pack` in subsequent commands): Call `read_file` on the saved image path above to inspect `screenshot.jpg`; run `get_scene --selector "..." --cssProperty "..."` to inspect anchor `computedStyles`/`layoutContext` and matched CSS cascade rules; run `search_pack "<keyword>"` to search across `cascade.json` & `dom-context.json`; run `get_framework_state` for component props/data; or check `INDEX.md` and query `dom-context.json` / `cascade.json` / `environment.json` in the workspace directly with `jq`.',
    ),
    w(
      o.join(`
`),
      s,
    )
  );
}
function Sn(e) {
  let t = M(e.pack),
    s = e.format ?? "text";
  return t.kind === "session" ? Qs(t, s, e.maxChars) : Ys(t, s, e.maxChars);
}
function xn(e) {
  let t = M(e.pack);
  if (t.kind === "screenshot") {
    let i = t.environment?.recentConsoleErrors ?? [],
      c = e.search?.toLowerCase(),
      u = e.regex ? new RegExp(e.regex, "i") : void 0,
      o = i.filter((a) => {
        let l = `${a.message ?? ""}
${a.stack ?? ""}`;
        return !((c && !l.toLowerCase().includes(c)) || (u && !u.test(l)));
      });
    if (e.format === "json")
      return w(
        JSON.stringify(
          { totalEntries: i.length, matchedCount: o.length, items: o },
          null,
          2,
        ),
        e.maxChars,
      );
    let d = [
      `# Screenshot Pack Console Errors (${o.length} of ${i.length})`,
      ...o.map(
        (a, l) =>
          `[#${l}] [ERROR] ${a.message ?? ""}${
            a.stack
              ? `
    ${a.stack
      .split(
        `
`,
      )
      .slice(0, 4).join(`
    `)}`
              : ""
          }`,
      ),
    ];
    return w(
      d.join(`
`),
      e.maxChars,
    );
  }
  let s = qe(t, {
    levels: e.levels,
    search: e.search,
    regex: e.regex,
    fromMs: e.fromMs,
    toMs: e.toMs,
    offset: e.offset,
    limit: e.limit,
    unfold: e.unfold,
    minCount: e.minCount,
  });
  if (e.format === "json") return w(JSON.stringify(s, null, 2), e.maxChars);
  let n = [];
  if (
    (n.push(
      `# Console Logs (${s.folded ? "folded" : "unfolded"}, matched ${s.matchedCount} of ${s.totalEntries} total, showing offset=${s.offset}..${s.offset + s.items.length})`,
    ),
    s.items.length === 0)
  )
    n.push("(No console entries matched the given filters)");
  else for (let i of s.items) n.push(Ue(i, { unfold: e.unfold }));
  let r = s.matchedCount - (s.offset + s.items.length);
  return (
    r > 0 &&
      n.push(`
\u2026 ${r} more entries available. Use offset=${s.offset + s.items.length} to continue.`),
    w(
      n.join(`
`),
      e.maxChars,
    )
  );
}
function $n(e) {
  let t = M(e.pack);
  if (t.kind === "screenshot") {
    let i = t.environment?.recentFailedRequests ?? [],
      c = e.urlContains?.toLowerCase(),
      u = e.method?.toUpperCase(),
      o = i.filter(
        (a) =>
          !(
            (c && !(a.url ?? "").toLowerCase().includes(c)) ||
            (u && (a.method ?? "GET").toUpperCase() !== u)
          ),
      );
    if (e.format === "json")
      return w(
        JSON.stringify(
          { totalEntries: i.length, matchedCount: o.length, items: o },
          null,
          2,
        ),
        e.maxChars,
      );
    let d = [
      `# Screenshot Pack Failed Network Requests (${o.length} of ${i.length})`,
      ...o.map(
        (a, l) =>
          `- [#${l}] ${a.method ?? "GET"} !${a.status ?? 0} ${a.statusText ?? ""} | ${a.url ?? ""}`,
      ),
    ];
    return w(
      d.join(`
`),
      e.maxChars,
    );
  }
  let s = De(t, {
    status: e.status,
    bizError: e.bizError,
    bizCode: e.bizCode,
    urlContains: e.urlContains,
    method: e.method,
    type: e.type,
    offset: e.offset,
    limit: e.limit,
  });
  if (e.format === "json") return w(JSON.stringify(s, null, 2), e.maxChars);
  let n = [];
  if (
    (n.push(
      `# Network Requests (matched ${s.matchedCount} of ${s.totalEntries} total, showing offset=${s.offset}..${s.offset + s.items.length})`,
    ),
    s.items.length === 0)
  )
    n.push("(No network requests matched the given filters)");
  else for (let i of s.items) n.push(`- ${ze(i)}`);
  let r = s.matchedCount - (s.offset + s.items.length);
  return (
    r > 0 &&
      n.push(`
\u2026 ${r} more requests available. Use offset=${s.offset + s.items.length} to continue, or call get_request(id) to inspect a specific request.`),
    w(
      n.join(`
`),
      e.maxChars,
    )
  );
}
import { existsSync as er, readFileSync as tr } from "node:fs";
import { resolve as kn, sep as nr } from "node:path";
function sr(e, t) {
  if (!e) return;
  let s = kn(e),
    n = kn(s, ...t.split("/"));
  if (!(!n.startsWith(s + nr) || !er(n))) return tr(n, "utf8");
}
function bn(e) {
  let t = M(e.pack),
    s = e.path.replace(/^\.?\//, ""),
    n = t.getTextFile(s) ?? sr(z(t), s);
  if (n === void 0) {
    let o = t
      .listFiles()
      .map((d) => d.path)
      .slice(0, 30)
      .join(", ");
    throw new Error(
      `FILE_NOT_FOUND_IN_PACK: "${s}" does not exist in pack. Available files sample: [${o}]`,
    );
  }
  if (e.jsonPath) {
    let o;
    if (s.endsWith(".js")) o = te(n, s);
    else
      try {
        o = JSON.parse(n);
      } catch (a) {
        let l = a instanceof Error ? a.message : String(a);
        throw new Error(
          `INVALID_JSON_FILE: Cannot apply jsonPath "${e.jsonPath}" to "${s}": ${l}`,
        );
      }
    let d = se(o, e.jsonPath);
    return w(JSON.stringify(d, null, 2), e.maxChars ?? 24e3);
  }
  let r = Math.max(0, e.offset ?? 0),
    i = e.maxChars ?? 24e3,
    c = n.slice(r),
    u = r + i;
  return w(
    c,
    i,
    n.length > u
      ? `Use offset=${u} to read the next chunk (total ${n.length} chars).`
      : void 0,
  );
}
function wt(e, t, s = 180, n = 3) {
  let r = t.includes("svg")
      ? e
      : e.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "<svg/>"),
    i = r.toLowerCase(),
    c = [],
    u = 0;
  for (; u < i.length && c.length < n;) {
    let o = i.indexOf(t, u);
    if (o < 0) break;
    let d = Math.max(0, o - s),
      a = Math.min(r.length, o + t.length + s),
      l = c[c.length - 1];
    (l && d <= l.end
      ? (l.end = Math.max(l.end, a))
      : c.push({ start: d, end: a }),
      (u = o + Math.max(1, t.length)));
  }
  return c.length === 0
    ? [
        r
          .slice(0, s * 2)
          .replace(/\s+/g, " ")
          .trim(),
      ]
    : c.map(({ start: o, end: d }) => {
        let a = o > 0 ? "\u2026" : "",
          l = d < r.length ? "\u2026" : "";
        return a + r.slice(o, d).replace(/\s+/g, " ").trim() + l;
      });
}
function En(e, t) {
  let s = t.query.trim();
  if (!s) return { query: s, totalHits: 0, hits: [] };
  let n = s.toLowerCase(),
    r = new Set(
      t.scopes && t.scopes.length > 0
        ? t.scopes
        : [
            "console",
            "network-url",
            "network-body",
            "interactions",
            "framework",
          ],
    ),
    i = Math.max(1, t.limit ?? 30),
    c = Math.min(2e3, Math.max(40, t.contextChars ?? 180)),
    u = [];
  if (
    (r.has("console") &&
      e.getConsoleEntries().forEach((o, d) => {
        let a = `${o.text ?? ""} ${o.url ?? ""} ${o.stackTrace ?? o.stack ?? ""}`;
        if (a.toLowerCase().includes(n)) {
          let l = e.toRelativeMs(o.createdAt),
            [f] = wt(a, n, c, 1);
          u.push({
            scope: "console",
            ref: `console#${d}`,
            relativeMs: l,
            snippet: `${I(l)} [${o.level ?? "log"}] ${f}`,
          });
        }
      }),
    r.has("network-url"))
  ) {
    for (let o of e.getNetworkEntries())
      if (o.url.toLowerCase().includes(n)) {
        let d = e.toRelativeMs(o.createdAt);
        u.push({
          scope: "network-url",
          ref: o.id,
          relativeMs: d,
          snippet: `${I(d)} ${o.method ?? "GET"} ${o.status ?? 0} ${o.url}`,
        });
      }
  }
  if (r.has("network-body"))
    for (let o of e.getNetworkEntries()) {
      let d = e.getNetworkBody(o);
      if (d && d.toLowerCase().includes(n)) {
        let a = e.toRelativeMs(o.createdAt),
          l = wt(d, n, c, 3);
        for (let f of l)
          u.push({
            scope: "network-body",
            ref: o.id,
            relativeMs: a,
            snippet: `${I(a)} (${o.url}) ${f}`,
          });
      }
    }
  return (
    r.has("interactions") &&
      e.getInteractions().forEach((o, d) => {
        let a = he(o, d, e.toRelativeMs(o.createdAt)),
          l = JSON.stringify(o.element ?? o.target ?? {});
        (a.toLowerCase().includes(n) || l.toLowerCase().includes(n)) &&
          u.push({
            scope: "interactions",
            ref: `interaction#${d}`,
            relativeMs: e.toRelativeMs(o.createdAt),
            snippet: a,
          });
      }),
    r.has("framework") &&
      e.getFrameworkStates().forEach((o, d) => {
        let a = JSON.stringify(o);
        if (a.toLowerCase().includes(n)) {
          let l = e.toRelativeMs(o.capturedAtEpochMs),
            f = wt(a, n, c, 2);
          for (let m of f)
            u.push({
              scope: "framework",
              ref: `frameworkState#${d}`,
              relativeMs: l,
              snippet: `${I(l)} [trigger=${o.trigger ?? "?"}] ${m}`,
            });
        }
      }),
    { query: s, totalHits: u.length, hits: u.slice(0, i) }
  );
}
function rr(e, t, s = 30, n = 180) {
  let r = t.trim().toLowerCase();
  if (!r) return { totalHits: 0, hits: [] };
  let i = [];
  if (
    ((e.domContext?.anchors ?? []).forEach((o, d) => {
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
          .includes(r)
      ) {
        let l = o.componentName
            ? ` [${o.componentName}${o.componentFile ? ` @ ${o.componentFile}:${o.componentLine ?? ""}` : ""}]`
            : "",
          f = o.layoutContext?.textOverflow?.reason;
        i.push({
          category: "dom-anchor",
          ref: `anchor#${d}`,
          detail: `\`${o.selectorPath ?? o.selector ?? "?"}\`${l} text="${(o.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 80)}"${f ? ` | overflow: ${f}` : ""} | styles=${JSON.stringify(o.computedStyles ?? {})}`,
        });
      }
    }),
    e.cascade)
  ) {
    let o = e.cascade.sheets ?? [],
      d = e.cascade.rules ?? [],
      a = e.cascade.elements ?? [],
      l = new Map();
    for (let h of o) l.set(h.id, h);
    let f = new Map();
    for (let h of d) f.set(h.id, h);
    let m = new Map();
    for (let h of a) {
      let $ = `${h.id}(${h.selector})`;
      for (let g of h.matchedRuleIds ?? []) {
        let v = m.get(g);
        v ? v.push($) : m.set(g, [$]);
      }
    }
    for (let h of o)
      (h.id.toLowerCase() === r ||
        (h.href && h.href.toLowerCase().includes(r))) &&
        i.push({
          category: "cascade-sheet",
          ref: h.id,
          detail: `href=${h.href ?? "inline"} (${h.rulesCount ?? 0} rules, tag=<${h.ownerNodeTag ?? "style"}>)`,
        });
    for (let [h, $] of a.entries())
      if ($.id.toLowerCase() === r || $.selector.toLowerCase().includes(r)) {
        let g = ($.matchedRuleIds ?? [])
          .slice(-6)
          .map((v) => {
            let S = f.get(v);
            return S ? `${v}:${S.selectorText}` : v;
          })
          .join(", ");
        i.push({
          category: "cascade-element",
          ref: `${$.id} (index ${h})`,
          detail: `<${$.tagName}> \`${$.selector}\` (${($.matchedRuleIds ?? []).length} matched rules, e.g. [${g}])`,
        });
      }
    let p = new Map();
    for (let h of d)
      if (
        h.id.toLowerCase() === r ||
        h.selectorText.toLowerCase().includes(r) ||
        h.cssText.toLowerCase().includes(r)
      ) {
        let $ = `${h.selectorText}||${h.cssText}`,
          g = l.get(h.sheetId),
          v = g?.href ? `${h.sheetId} (${g.href})` : `${h.sheetId} (inline)`,
          S = m.get(h.id) ?? [],
          y = p.get($);
        if (y) {
          (y.ruleIds.push(h.id), y.sheetRefs.add(v));
          for (let x of S) y.matchedElements.add(x);
        } else
          p.set($, {
            rule: h,
            ruleIds: [h.id],
            sheetRefs: new Set([v]),
            matchedElements: new Set(S),
          });
      }
    for (let h of p.values()) {
      let $ =
          h.ruleIds.length > 3
            ? `${h.ruleIds.slice(0, 3).join(", ")} (+${h.ruleIds.length - 3})`
            : h.ruleIds.join(", "),
        g = Array.from(h.sheetRefs).slice(0, 2).join(" | "),
        v = Array.from(h.matchedElements),
        S =
          v.length > 0
            ? ` | matchedElements: [${v.slice(0, 5).join(", ")}${v.length > 5 ? ", ..." : ""}]`
            : "";
      i.push({
        category: "cascade-rule",
        ref: $,
        detail: `[sheet: ${g}] \`${h.rule.selectorText}\` -> \`${h.rule.cssText}\`${S}`,
      });
    }
  }
  if (
    ((
      e.environment?.frameworkComponentStates ??
      e.environment?.vueComponentStates ??
      []
    ).forEach((o, d) => {
      JSON.stringify(o).toLowerCase().includes(r) &&
        i.push({
          category: "component-state",
          ref: `${o.componentName ?? "Component"}#${d}`,
          detail: `${o.componentFile ? `@ ${o.componentFile}:${o.componentLine ?? ""} ` : ""}props=${JSON.stringify(o.props ?? {})} data=${JSON.stringify(o.data ?? o.state ?? {})}`,
        });
    }),
    i.length === 0)
  ) {
    for (let o of e.listFiles())
      if (o.path.endsWith(".json") || o.path.endsWith(".md")) {
        let d = e.getTextFile(o.path) ?? "",
          a = d.toLowerCase().indexOf(r);
        if (a >= 0) {
          let l = Math.max(0, a - n),
            f = Math.min(d.length, a + r.length + n);
          i.push({
            category: "file",
            ref: o.path,
            detail: d.slice(l, f).replace(/\s+/g, " ").trim(),
          });
        }
      }
  }
  return { totalHits: i.length, hits: i.slice(0, s) };
}
function Cn(e) {
  let t = M(e.pack),
    s = Math.min(2e3, Math.max(40, e.contextChars ?? 180));
  if (t.kind === "screenshot") {
    let i = rr(t, e.query, e.limit ?? 30, s);
    if (e.format === "json")
      return w(
        JSON.stringify(
          { query: e.query, totalHits: i.totalHits, hits: i.hits },
          null,
          2,
        ),
        e.maxChars,
      );
    let c = [
      `# Search Results in Screenshot Pack for "${e.query}" (showing ${i.hits.length} of ${i.totalHits} total hits)`,
      ...(i.hits.length === 0
        ? [
            "(No matches found in dom-context.json, cascade.json, or environment.json)",
          ]
        : i.hits.map(
            (u) => `- **[${u.category}]** \`${u.ref}\` \u2014 ${u.detail}`,
          )),
    ];
    return w(
      c.join(`
`),
      e.maxChars,
    );
  }
  let n = En(t, {
    query: e.query,
    scopes: e.scopes,
    limit: e.limit,
    contextChars: e.contextChars,
  });
  if (e.format === "json") return w(JSON.stringify(n, null, 2), e.maxChars);
  let r = [];
  if (
    (r.push(
      `# Search Hits for "${n.query}" (showing ${n.hits.length} of ${n.totalHits} total hits)`,
    ),
    n.hits.length === 0)
  )
    r.push("(No matches found across requested scopes)");
  else
    for (let i of n.hits)
      r.push(`- **[${i.scope}]** \`${i.ref}\` \u2014 ${i.snippet}`);
  return w(
    r.join(`
`),
    e.maxChars,
  );
}
function Mn(e, t = {}) {
  let s = new Set(
      t.kinds && t.kinds.length > 0
        ? t.kinds
        : ["interaction", "console", "network", "scene"],
    ),
    n = t.fromMs,
    r = t.toMs,
    i = "Full session timeline";
  if (
    t.aroundSceneId !== void 0 ||
    (n === void 0 && r === void 0 && t.windowMs !== void 0)
  ) {
    let d = e.getIssueScenes(),
      a = t.aroundSceneId
        ? (d.find(
            (l) =>
              l.id === t.aroundSceneId || String(l.index) === t.aroundSceneId,
          ) ?? d[0])
        : d[0];
    if (a) {
      let l =
          a.scene.selectionStartedAtEpochMs ??
          a.scene.observedAtEpochMs ??
          a.scene.sequenceContext?.anchorEpochMs,
        f = e.toRelativeMs(l);
      if (f !== void 0) {
        let m = t.windowMs ?? 15e3;
        ((n = f - m),
          (r = f + Math.min(5e3, Math.floor(m / 3))),
          (i = `Around scene "${a.id}" (${I(n)} .. ${I(r)})`));
      }
    }
  } else
    (n !== void 0 || r !== void 0) &&
      (i = `Range ${I(n ?? 0)} .. ${I(r ?? 1 / 0)}`);
  let c = [];
  if (
    (s.has("interaction") &&
      e.getInteractions().forEach((a, l) => {
        let f = e.toRelativeMs(a.createdAt) ?? a.elapsedMs ?? 0,
          m = a.createdAt ?? e.toEpochMs(f);
        c.push({
          kind: "interaction",
          epochMs: m,
          relativeMs: f,
          refId: l,
          summary: he(a, l, f),
        });
      }),
    s.has("console") &&
      e.getConsoleEntries().forEach((a, l) => {
        let f = (a.level ?? "log").toLowerCase();
        if (
          !t.includeAllConsole &&
          f !== "error" &&
          f !== "warning" &&
          f !== "warn"
        )
          return;
        let m = e.toRelativeMs(a.createdAt) ?? 0,
          p = a.createdAt ?? e.toEpochMs(m),
          h = (a.text ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
        c.push({
          kind: "console",
          epochMs: p,
          relativeMs: m,
          refId: a.id ?? l,
          summary: `${I(m)} [console.${f}] ${h}`,
        });
      }),
    s.has("network") &&
      e.getNetworkEntries().forEach((a) => {
        let l = e.toRelativeMs(a.createdAt) ?? 0;
        if ((n !== void 0 && l < n) || (r !== void 0 && l > r)) return;
        let f = a.status ?? 0,
          m = (a.type ?? "").toLowerCase(),
          p = m === "xhr" || m === "fetch" || m === "document",
          h = Be(a),
          $ = vt(e, a, {
            allowBodyScan: !h && (!m || m === "xhr" || m === "fetch"),
            maxScanBytes: 256 * 1024,
          }),
          g = h || $.isBizError;
        if (!t.includeAllNetwork && !g && !p) return;
        let v = a.createdAt ?? e.toEpochMs(l),
          S = a.method ?? "GET",
          y = Y(a.durationMs),
          x = $.isBizError ? St(f, $) : h ? `!${f || "ERR"}` : String(f);
        c.push({
          kind: "network",
          epochMs: v,
          relativeMs: l,
          refId: a.id,
          summary: `${I(l)} [net ${S} ${x} ${y}] ${a.url} (id=${a.id})`,
        });
      }),
    s.has("scene"))
  )
    for (let d of e.getIssueScenes()) {
      let a = d.scene.selectionStartedAtEpochMs ?? d.scene.observedAtEpochMs,
        l = e.toRelativeMs(a) ?? 0,
        f = d.scene.narrative?.actual ?? "(no narrative)";
      c.push({
        kind: "scene",
        epochMs: a ?? e.toEpochMs(l),
        relativeMs: l,
        refId: d.id,
        summary: `${I(l)} [ISSUE SCENE ${d.id}] actual="${f}"`,
      });
    }
  let u = c
      .filter(
        (d) =>
          !(
            (n !== void 0 && d.relativeMs < n) ||
            (r !== void 0 && d.relativeMs > r)
          ),
      )
      .sort((d, a) => d.relativeMs - a.relativeMs),
    o = t.limit ?? 80;
  return {
    windowDescription: i,
    totalMatched: u.length,
    events: u.slice(0, o),
  };
}
function In(e) {
  let t = M(e.pack);
  if (t.kind !== "session")
    throw new Error(
      `UNSUPPORTED_PACK_KIND: timeline requires a session evidence pack, but "${e.pack}" is a screenshot pack.`,
    );
  let s = Mn(t, {
    aroundSceneId: e.aroundSceneId,
    fromMs: e.fromMs,
    toMs: e.toMs,
    windowMs: e.windowMs,
    kinds: e.kinds,
    includeAllConsole: e.includeAllConsole,
    includeAllNetwork: e.includeAllNetwork,
    limit: e.limit,
  });
  if (e.format === "json") return w(JSON.stringify(s, null, 2), e.maxChars);
  let n = [];
  if (
    (n.push(
      `# Unified Timeline (${s.windowDescription}) \u2014 showing ${s.events.length} of ${s.totalMatched} events`,
    ),
    s.events.length === 0)
  )
    n.push("(No events matched the specified time window and filters)");
  else for (let r of s.events) n.push(`- ${r.summary}`);
  return (
    s.totalMatched > s.events.length &&
      n.push(`
\u2026 ${s.totalMatched - s.events.length} more events omitted. Pass a higher \`limit\` or narrow \`fromMs\`/\`toMs\`.`),
    w(
      n.join(`
`),
      e.maxChars,
    )
  );
}
var ar = new Set([
  "unfold",
  "bizError",
  "biz_error",
  "settled",
  "final",
  "help",
  "version",
  "includeImage",
  "include_image",
  "includeScreenshot",
  "include_screenshot",
  "includeAllNetwork",
  "include_all_network",
  "includeAllConsole",
  "include_all_console",
]);
function cr(e) {
  let t = {},
    s = [];
  for (let r = 0; r < e.length; r++) {
    let i = e[r];
    if (i === "--") {
      s.push(...e.slice(r + 1));
      break;
    }
    if (i.startsWith("--")) {
      let u = i.indexOf("=");
      if (u > 2) {
        let o = i.slice(2, u),
          d = i.slice(u + 1);
        t[o] = d;
      } else {
        let o = i.slice(2);
        if (ar.has(o)) {
          let a = e[r + 1]?.toLowerCase();
          a === "true" ||
          a === "false" ||
          a === "1" ||
          a === "0" ||
          a === "yes" ||
          a === "no"
            ? ((t[o] = a === "true" || a === "1" || a === "yes"), r++)
            : (t[o] = !0);
          continue;
        }
        let d = e[r + 1];
        d !== void 0 && !d.startsWith("--") ? ((t[o] = d), r++) : (t[o] = !0);
      }
      continue;
    }
    let c = /^([a-zA-Z][a-zA-Z0-9_]*)=(.+)$/.exec(i);
    if (c && !He(i)) {
      t[c[1]] = c[2];
      continue;
    }
    s.push(i);
  }
  let n =
    typeof t.json == "string"
      ? t.json
      : s[0]?.trim().startsWith("{")
        ? s.shift()
        : void 0;
  if (n)
    try {
      let r = JSON.parse(n);
      for (let [i, c] of Object.entries(r))
        typeof c == "boolean" || typeof c == "string"
          ? (t[i] = c)
          : typeof c == "number"
            ? (t[i] = String(c))
            : Array.isArray(c) && (t[i] = c.join(","));
    } catch {}
  return { flags: t, positionals: s };
}
function E(e, ...t) {
  for (let s of t) {
    let n = e[s];
    if (typeof n == "string" && n.trim().length > 0) return n.trim();
  }
}
function N(e, ...t) {
  let s = E(e, ...t);
  if (s === void 0) return;
  let n = Number(s);
  return Number.isFinite(n) ? n : void 0;
}
function U(e, ...t) {
  for (let s of t) {
    let n = e[s];
    if (typeof n == "boolean") return n;
    if (typeof n == "string") {
      let r = n.trim().toLowerCase();
      if (r === "true" || r === "1" || r === "yes") return !0;
      if (r === "false" || r === "0" || r === "no") return !1;
    }
  }
}
function we(e, ...t) {
  let s = E(e, ...t);
  if (!s) return;
  let n = s
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  return n.length > 0 ? n : void 0;
}
function lr(e) {
  return e ? (/\.zip$/i.test(e) ? !0 : He(e)) : !1;
}
function L(e, t, s = !1) {
  let n = E(e, "pack", "p");
  return n
    ? { pack: n, rest: t }
    : t.length > 0 && (s || lr(t[0]))
      ? { pack: t[0], rest: t.slice(1) }
      : { pack: void 0, rest: t };
}
function We(e) {
  return e.filter((t) => t.type === "text").map((t) => t.text).join(`

`);
}
function ur() {
  return `Bug Lens Evidence Triage CLI
Usage: node bug-lens-cli.mjs <command> [options]

Commands:
  open_pack <zipOrDir>                        Extract pack to workspace (idempotent), generate derived JSON & INDEX.md, cache session path, and print overview
  get_scene [--selector S] [--cssProperty P]  Inspect issue scene (session) or DOM anchor & CSS cascade rules (screenshot)
  get_css [--scene ID] [--property P]       Inspect winner CSS rules & computed layout styles (v5 dom-styles / cascade)
  get_screenshot [--step N] [--settled|--final] Locate screenshot image (instant, settled, final, or issue) and print path
  compare_frames [--step N] [--final|--to M]  Compare before/after visual frames (instant vs settled, or step vs final)
  timeline [--aroundSceneId ID] [--windowMs]  Unified chronological timeline of interactions, console errors, and network requests
  query_console [--levels error,warning]      Filter console logs (folded by fingerprint; supports --unfold and --minCount)
  query_network [--status failed|biz_error]   Filter network requests (prioritizes failures, supports --bizError)
  get_request <id> [--include body]           Inspect request headers, request body, initiator stack, and response body (with JSONPath)
  get_interactions [--fromIndex N] [--limit]  List recorded user interactions
  get_framework_state [--component NAME]      Inspect Vue/React component props, state, and webStorage snapshots
  search_pack <query>                         Cross-search console, network URLs/bodies, interactions, cascade rules, and state
  read_pack_file <path> [--jsonPath EXPR]     Read raw JSON/JS/text file or workspace artifact (INDEX.md, data/*.json)
  extract_pack [--dest DIR]                   Describe active workspace or copy extracted pack to custom directory`;
}
function fr(e) {
  let t = e[0]?.trim();
  if (
    !t ||
    t === "-h" ||
    t === "--help" ||
    t === "help" ||
    e.slice(1).some((u) => u === "-h" || u === "--help")
  )
    return ur();
  let s = t.replace(/-/g, "_").toLowerCase(),
    { flags: n, positionals: r } = cr(e.slice(1)),
    i = E(n, "format") === "json" ? "json" : "text",
    c = N(n, "maxChars", "max_chars");
  switch (s) {
    case "open_pack": {
      let { pack: u } = L(n, r, !0);
      if (!u)
        throw new Error(
          "Usage: bug-lens-cli.mjs open_pack <zipPath> [--format text|json]",
        );
      return Sn({ pack: u, format: i, maxChars: c });
    }
    case "get_scene": {
      let { pack: u, rest: o } = L(n, r),
        d = N(n, "sceneIndex", "scene_index", "index"),
        a = E(n, "sceneId", "scene_id"),
        l = E(n, "selector", "s") ?? o[0],
        f = E(n, "cssProperty", "css_property", "prop"),
        m = U(
          n,
          "includeImage",
          "include_image",
          "includeScreenshot",
          "include_screenshot",
        ),
        p = gn({
          pack: u,
          sceneId:
            a ?? (d === void 0 && o[0] && /^\d+$/.test(o[0]) ? o[0] : void 0),
          sceneIndex: d,
          selector: l,
          cssProperty: f,
          includeImage: m,
          format: i,
          maxChars: c,
        });
      return We(p);
    }
    case "get_screenshot": {
      let { pack: u, rest: o } = L(n, r),
        d = E(n, "kind") ?? o[0],
        a = N(n, "step"),
        l = U(n, "settled"),
        f = U(n, "final"),
        m = E(n, "sceneId", "scene_id"),
        p = yn({ pack: u, kind: d, step: a, settled: l, final: f, sceneId: m });
      return We(p);
    }
    case "get_css": {
      let { pack: u, rest: o } = L(n, r);
      return ln({
        pack: u,
        scene: E(n, "scene") ?? o[0],
        sceneId: E(n, "sceneId", "scene_id"),
        sceneIndex: N(n, "sceneIndex", "scene_index", "index"),
        selector: E(n, "selector", "s"),
        property: E(n, "property", "cssProperty", "css_property", "prop"),
        format: i,
        maxChars: c,
      });
    }
    case "compare_frames": {
      let { pack: u } = L(n, r),
        o = U(
          n,
          "includeImage",
          "include_image",
          "includeScreenshot",
          "include_screenshot",
        ),
        d = rn({
          pack: u,
          step: N(n, "step"),
          from: N(n, "from"),
          to: N(n, "to"),
          against: E(n, "against"),
          settled: U(n, "settled"),
          final: U(n, "final"),
          left: E(n, "left"),
          right: E(n, "right"),
          includeImage: o,
          format: i,
          maxChars: c,
        });
      return We(d);
    }
    case "timeline": {
      let { pack: u, rest: o } = L(n, r),
        d = E(n, "aroundSceneId", "around_scene_id", "around") ?? o[0],
        a = d?.startsWith("scene:")
          ? String(Math.max(0, Number(d.slice(6)) - 1))
          : d;
      return In({
        pack: u,
        aroundSceneId: a,
        fromMs: N(n, "fromMs", "from_ms"),
        toMs: N(n, "toMs", "to_ms"),
        windowMs: N(n, "windowMs", "window_ms"),
        kinds: we(n, "kinds", "kind"),
        includeAllConsole: U(n, "includeAllConsole", "include_all_console"),
        includeAllNetwork: U(n, "includeAllNetwork", "include_all_network"),
        limit: N(n, "limit"),
        format: i,
        maxChars: c,
      });
    }
    case "query_console": {
      let { pack: u, rest: o } = L(n, r);
      return xn({
        pack: u,
        levels: we(n, "levels", "level"),
        search: E(n, "search", "query", "q") ?? o[0],
        regex: E(n, "regex"),
        fromMs: N(n, "fromMs", "from_ms"),
        toMs: N(n, "toMs", "to_ms"),
        offset: N(n, "offset"),
        limit: N(n, "limit"),
        unfold: U(n, "unfold"),
        minCount: N(n, "minCount", "min_count"),
        format: i,
        maxChars: c,
      });
    }
    case "query_network": {
      let { pack: u, rest: o } = L(n, r),
        d = E(n, "status"),
        a = U(n, "bizError", "biz_error"),
        l = E(n, "bizCode", "biz_code"),
        f =
          d === "biz_error" || d === "bizError"
            ? "biz_error"
            : d && /^\d+(,\d+)*$/.test(d)
              ? d.split(",").map(Number)
              : d;
      return $n({
        pack: u,
        status: f,
        bizError: a,
        bizCode: l,
        urlContains: E(n, "urlContains", "url_contains", "url") ?? o[0],
        method: E(n, "method"),
        type: E(n, "type"),
        offset: N(n, "offset"),
        limit: N(n, "limit"),
        format: i,
        maxChars: c,
      });
    }
    case "get_request": {
      let { pack: u, rest: o } = L(n, r),
        d = E(n, "id", "requestId", "request_id") ?? o[0];
      if (!d)
        throw new Error(
          "Usage: bug-lens-cli.mjs get_request <id> [--jsonPath EXPR]",
        );
      return mn({
        pack: u,
        id: d,
        include: we(n, "include"),
        jsonPath: E(n, "jsonPath", "json_path") ?? o[1],
        bodyMaxChars: N(n, "bodyMaxChars", "body_max_chars"),
        format: i,
        maxChars: c,
      });
    }
    case "get_interactions": {
      let { pack: u } = L(n, r),
        o = fn({
          pack: u,
          fromIndex: N(n, "fromIndex", "from_index"),
          limit: N(n, "limit"),
          kinds: we(n, "kinds", "kind"),
          includeScreenshot: U(n, "includeScreenshot", "include_screenshot"),
          format: i,
          maxChars: c,
        });
      return We(o);
    }
    case "get_framework_state": {
      let { pack: u, rest: o } = L(n, r);
      return un({
        pack: u,
        index: N(n, "index"),
        nearMs: N(n, "nearMs", "near_ms"),
        component: E(n, "component") ?? o[0],
        path: E(n, "path", "jsonPath", "json_path"),
        format: i,
        maxChars: c,
      });
    }
    case "search_pack": {
      let { pack: u, rest: o } = L(n, r),
        d = E(n, "query", "q") ?? o[0];
      if (!d) throw new Error("Usage: bug-lens-cli.mjs search_pack <query>");
      return Cn({
        pack: u,
        query: d,
        scopes: we(n, "scopes", "scope"),
        limit: N(n, "limit"),
        contextChars: N(n, "contextChars", "context_chars"),
        format: i,
        maxChars: c,
      });
    }
    case "read_pack_file": {
      let { pack: u, rest: o } = L(n, r),
        d = E(n, "path", "file") ?? o[0];
      if (!d)
        throw new Error(
          "Usage: bug-lens-cli.mjs read_pack_file <path> [--jsonPath EXPR]",
        );
      return bn({
        pack: u,
        path: d,
        jsonPath: E(n, "jsonPath", "json_path") ?? o[1],
        offset: N(n, "offset"),
        maxChars: c,
      });
    }
    case "extract_pack": {
      let { pack: u, rest: o } = L(n, r);
      return on({ pack: u, dest: E(n, "dest", "d") ?? o[0], format: i });
    }
    default:
      throw new Error(
        `UNKNOWN_COMMAND: Unknown command "${t}". Run with --help to see available commands.`,
      );
  }
}
function dr() {
  if (typeof process > "u" || !Array.isArray(process.argv) || !process.argv[1])
    return !1;
  let e = process.argv[1];
  if (e.endsWith("bug-lens-cli.mjs") || e.endsWith("cli.ts")) return !0;
  try {
    let t = ir(import.meta.url),
      s = or(e),
      n = He(s) ? Nn(s) : s,
      r = He(t) ? Nn(t) : t;
    return n === r;
  } catch {
    return !1;
  }
}
var hr = dr();
if (hr)
  try {
    let e = fr(process.argv.slice(2));
    process.stdout.write(
      e +
        `
`,
    );
  } catch (e) {
    let t = e instanceof Error ? e.message : String(e);
    (process.stderr.write(`Error: ${t}
`),
      process.exit(1));
  }
export { fr as runTriageCli };
