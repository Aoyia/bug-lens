#!/usr/bin/env node
import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
import { existsSync as Fe, realpathSync as on } from "node:fs";
import { resolve as Ss } from "node:path";
import { fileURLToPath as ws } from "node:url";
function w(e, t = 24e3, s) {
  let n = typeof t == "number" && t > 200 ? Math.floor(t) : 24e3;
  if (e.length <= n) return e;
  let r = s
      ? ` ${s}`
      : " Pass a larger maxChars or narrower filter/jsonPath to inspect further.",
    a = `

\u2026 [Truncated to ${n} chars (original ${e.length} chars).${r}]`,
    c = Math.max(100, n - a.length),
    u = e.slice(0, c),
    o = u.lastIndexOf(`
`),
    l = o > c * 0.75 ? o : c;
  return u.slice(0, l).trimEnd() + a;
}
import { createRequire as hn } from "module";
var dn = hn("/"),
  oe,
  pn,
  mn;
try {
  ((oe = dn("worker_threads")),
    (pn = oe.Worker),
    (mn = oe.isMarkedAsUntransferable));
} catch {}
var j = Uint8Array,
  re = Uint16Array,
  gn = Int32Array,
  mt = new j([
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5,
    5, 5, 5, 0, 0, 0, 0,
  ]),
  gt = new j([
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10,
    11, 11, 12, 12, 13, 13, 0, 0,
  ]),
  yn = new j([
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
  ]),
  yt = function (e, t) {
    for (var s = new re(31), n = 0; n < 31; ++n) s[n] = t += 1 << e[n - 1];
    for (var r = new gn(s[30]), n = 1; n < 30; ++n)
      for (var a = s[n]; a < s[n + 1]; ++a) r[a] = ((a - s[n]) << 5) | n;
    return { b: s, r };
  },
  oe = yt(mt, 2),
  vt = oe.b,
  vn = oe.r;
((vt[28] = 258), (vn[258] = 28));
var xt = yt(gt, 0),
  xn = xt.b,
  Ns = xt.r,
  Ue = new re(32768);
for (C = 0; C < 32768; ++C)
  ((B = ((C & 43690) >> 1) | ((C & 21845) << 1)),
    (B = ((B & 52428) >> 2) | ((B & 13107) << 2)),
    (B = ((B & 61680) >> 4) | ((B & 3855) << 4)),
    (Ue[C] = (((B & 65280) >> 8) | ((B & 255) << 8)) >> 1));
var B,
  C,
  ue = function (e, t, s) {
    for (var n = e.length, r = 0, a = new re(t); r < n; ++r)
      e[r] && ++a[e[r] - 1];
    var c = new re(t);
    for (r = 1; r < t; ++r) c[r] = (c[r - 1] + a[r - 1]) << 1;
    var u;
    if (s) {
      u = new re(1 << t);
      var o = 15 - t;
      for (r = 0; r < n; ++r)
        if (e[r])
          for (
            var l = (r << 4) | e[r],
              i = t - e[r],
              f = c[e[r] - 1]++ << i,
              h = f | ((1 << i) - 1);
            f <= h;
            ++f
          )
            u[Ue[f] >> o] = l;
    } else
      for (u = new re(n), r = 0; r < n; ++r)
        e[r] && (u[r] = Ue[c[e[r] - 1]++] >> (15 - e[r]));
    return u;
  },
  fe = new j(288);
for (C = 0; C < 144; ++C) fe[C] = 8;
var C;
for (C = 144; C < 256; ++C) fe[C] = 9;
var C;
for (C = 256; C < 280; ++C) fe[C] = 7;
var C;
for (C = 280; C < 288; ++C) fe[C] = 8;
var C,
  $t = new j(32);
for (C = 0; C < 32; ++C) $t[C] = 5;
var C;
var $n = ue(fe, 9, 1);
var Sn = ue($t, 5, 1),
  ze = function (e) {
    for (var t = e[0], s = 1; s < e.length; ++s) e[s] > t && (t = e[s]);
    return t;
  },
  z = function (e, t, s) {
    var n = (t / 8) | 0;
    return ((e[n] | (e[n + 1] << 8)) >> (t & 7)) & s;
  },
  qe = function (e, t) {
    var s = (t / 8) | 0;
    return (e[s] | (e[s + 1] << 8) | (e[s + 2] << 16)) >> (t & 7);
  },
  wn = function (e) {
    return ((e + 7) / 8) | 0;
  },
  We = function (e, t, s) {
    return (
      (t == null || t < 0) && (t = 0),
      (s == null || s > e.length) && (s = e.length),
      new j(e.subarray(t, s))
    );
  };
var kn = [
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
  R = function (e, t, s) {
    var n = new Error(t || kn[e]);
    if (
      ((n.code = e),
      Error.captureStackTrace && Error.captureStackTrace(n, R),
      !s)
    )
      throw n;
    return n;
  },
  Cn = function (e, t, s, n) {
    var r = e.length,
      a = n ? n.length : 0;
    if (!r || (t.f && !t.l)) return s || new j(0);
    var c = !s,
      u = c || t.i != 2,
      o = t.i;
    c && (s = new j(r * 3));
    var l = function (ht) {
        var dt = s.length;
        if (ht > dt) {
          var pt = new j(Math.max(dt * 2, ht));
          (pt.set(s), (s = pt));
        }
      },
      i = t.f || 0,
      f = t.p || 0,
      h = t.b || 0,
      y = t.l,
      p = t.d,
      d = t.m,
      m = t.n,
      $ = r * 8;
    do {
      if (!y) {
        i = z(e, f, 1);
        var g = z(e, f + 1, 3);
        if (((f += 3), g))
          if (g == 1) ((y = $n), (p = Sn), (d = 9), (m = 5));
          else if (g == 2) {
            var k = z(e, f, 31) + 257,
              P = z(e, f + 10, 15) + 4,
              I = k + z(e, f + 5, 31) + 1;
            f += 14;
            for (var D = new j(I), Q = new j(19), T = 0; T < P; ++T)
              Q[yn[T]] = z(e, f + T * 3, 7);
            f += P * 3;
            for (
              var ce = ze(Q), an = (1 << ce) - 1, cn = ue(Q, ce, 1), T = 0;
              T < I;
            ) {
              var at = cn[z(e, f, an)];
              f += at & 15;
              var v = at >> 4;
              if (v < 16) D[T++] = v;
              else {
                var ne = 0,
                  ye = 0;
                for (
                  v == 16
                    ? ((ye = 3 + z(e, f, 3)), (f += 2), (ne = D[T - 1]))
                    : v == 17
                      ? ((ye = 3 + z(e, f, 7)), (f += 3))
                      : v == 18 && ((ye = 11 + z(e, f, 127)), (f += 7));
                  ye--;
                )
                  D[T++] = ne;
              }
            }
            var ct = D.subarray(0, k),
              G = D.subarray(k);
            ((d = ze(ct)), (m = ze(G)), (y = ue(ct, d, 1)), (p = ue(G, m, 1)));
          } else R(1);
        else {
          var v = wn(f) + 4,
            x = e[v - 4] | (e[v - 3] << 8),
            S = v + x;
          if (S > r) {
            o && R(0);
            break;
          }
          (u && l(h + x),
            s.set(e.subarray(v, S), h),
            (t.b = h += x),
            (t.p = f = S * 8),
            (t.f = i));
          continue;
        }
        if (f > $) {
          o && R(0);
          break;
        }
      }
      u && l(h + 131072);
      for (var ln = (1 << d) - 1, un = (1 << m) - 1, Oe = f; ; Oe = f) {
        var ne = y[qe(e, f) & ln],
          se = ne >> 4;
        if (((f += ne & 15), f > $)) {
          o && R(0);
          break;
        }
        if ((ne || R(2), se < 256)) s[h++] = se;
        else if (se == 256) {
          ((Oe = f), (y = null));
          break;
        } else {
          var lt = se - 254;
          if (se > 264) {
            var T = se - 257,
              le = mt[T];
            ((lt = z(e, f, (1 << le) - 1) + vt[T]), (f += le));
          }
          var Le = p[qe(e, f) & un],
            De = Le >> 4;
          (Le || R(3), (f += Le & 15));
          var G = xn[De];
          if (De > 3) {
            var le = gt[De];
            ((G += qe(e, f) & ((1 << le) - 1)), (f += le));
          }
          if (f > $) {
            o && R(0);
            break;
          }
          u && l(h + 131072);
          var ut = h + lt;
          if (h < G) {
            var ft = a - G,
              fn = Math.min(G, ut);
            for (ft + h < 0 && R(3); h < fn; ++h) s[h] = n[ft + h];
          }
          for (; h < ut; ++h) s[h] = s[h - G];
        }
      }
      ((t.l = y),
        (t.p = Oe),
        (t.b = h),
        (t.f = i),
        y && ((i = 1), (t.m = d), (t.d = p), (t.n = m)));
    } while (!i);
    return h != s.length && c ? We(s, 0, h) : s.subarray(0, h);
  };
var bn = new j(0);
var q = function (e, t) {
    return e[t] | (e[t + 1] << 8);
  },
  _ = function (e, t) {
    return (e[t] | (e[t + 1] << 8) | (e[t + 2] << 16) | (e[t + 3] << 24)) >>> 0;
  },
  Be = function (e, t) {
    return _(e, t) + _(e, t + 4) * 4294967296;
  };
function En(e, t) {
  return Cn(e, { i: 2 }, t && t.out, t && t.dictionary);
}
var Je = typeof TextDecoder < "u" && new TextDecoder(),
  Mn = 0;
try {
  (Je.decode(bn, { stream: !0 }), (Mn = 1));
} catch {}
var Pn = function (e) {
  for (var t = "", s = 0; ;) {
    var n = e[s++],
      r = (n > 127) + (n > 223) + (n > 239);
    if (s + r > e.length) return { s: t, r: We(e, s - 1) };
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
function An(e, t) {
  if (t) {
    for (var s = "", n = 0; n < e.length; n += 16384)
      s += String.fromCharCode.apply(null, e.subarray(n, n + 16384));
    return s;
  } else {
    if (Je) return Je.decode(e);
    var r = Pn(e),
      a = r.s,
      s = r.r;
    return (s.length && R(8), a);
  }
}
var In = function (e, t) {
    return t + 30 + q(e, t + 26) + q(e, t + 28);
  },
  Nn = function (e, t, s) {
    var n = q(e, t + 28),
      r = q(e, t + 30),
      a = An(e.subarray(t + 46, t + 46 + n), !(q(e, t + 8) & 2048)),
      c = t + 46 + n,
      u = Tn(e, c, r, s, _(e, t + 20), _(e, t + 24), _(e, t + 42)),
      o = u[0],
      l = u[1],
      i = u[2];
    return [q(e, t + 10), o, l, a, c + r + q(e, t + 32), i];
  },
  Tn = function (e, t, s, n, r, a, c) {
    var u = r == 4294967295,
      o = a == 4294967295,
      l = c == 4294967295,
      i = t + s,
      f = u + o + l;
    if (n && f) {
      for (; t + 4 < i; t += 4 + q(e, t + 2))
        if (q(e, t) == 1)
          return [
            u ? Be(e, t + 4 + 8 * o) : r,
            o ? Be(e, t + 4) : a,
            l ? Be(e, t + 4 + 8 * (o + u)) : c,
            1,
          ];
      n < 2 && R(13);
    }
    return [r, a, c, 0];
  };
function St(e, t) {
  for (var s = {}, n = e.length - 22; _(e, n) != 101010256; --n)
    (!n || e.length - n > 65558) && R(13);
  var r = q(e, n + 8);
  if (!r) return {};
  var a = _(e, n + 16),
    c = _(e, n - 20) == 117853008;
  if (c) {
    var u = _(e, n - 12);
    ((c = _(e, u) == 101075792), c && ((r = _(e, u + 32)), (a = _(e, u + 48))));
  }
  for (var o = t && t.filter, l = 0; l < r; ++l) {
    var i = Nn(e, a, c),
      f = i[0],
      h = i[1],
      y = i[2],
      p = i[3],
      d = i[4],
      m = i[5],
      $ = In(e, m);
    ((a = d),
      (!o || o({ name: p, size: h, originalSize: y, compression: f })) &&
        (f
          ? f == 8
            ? (s[p] = En(e.subarray($, $ + h), { out: new j(y) }))
            : R(14, "unknown compression type " + f)
          : (s[p] = We(e, $, $ + h))));
  }
  return s;
}
import { createHash as Dn } from "node:crypto";
import {
  copyFileSync as zn,
  existsSync as K,
  mkdirSync as be,
  readdirSync as Ze,
  readFileSync as pe,
  realpathSync as At,
  rmSync as It,
  statSync as Ee,
  writeFileSync as X,
} from "node:fs";
import { tmpdir as qn } from "node:os";
import {
  basename as Bn,
  dirname as Ve,
  join as N,
  posix as Un,
  resolve as F,
  sep as Et,
} from "node:path";
var ve = class {
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
function Rn(e) {
  return Array.isArray(e)
    ? `array[${e.length}]`
    : e === null
      ? "null"
      : typeof e;
}
function ie(e) {
  return !e || typeof e != "object" || Array.isArray(e)
    ? "\u2014"
    : Object.entries(e)
        .map(([t, s]) => `\`${t}\` (${Rn(s)})`)
        .join(", ");
}
function He(e) {
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
function Ge(e) {
  return e >= 1024 * 1024
    ? `${(e / 1024 / 1024).toFixed(1)} MB`
    : e >= 1024
      ? `${(e / 1024).toFixed(1)} KB`
      : `${e} B`;
}
function U(e) {
  return `"${e.replace(/(["\\$`])/g, "\\$1")}"`;
}
function J(e, t) {
  let s = e.includes("\\") && !e.includes("/") ? "\\" : "/";
  return `${e.replace(/[\\/]+$/, "")}${s}${t.split("/").join(s)}`;
}
function jn(e) {
  let t = e.listFiles(),
    s = [],
    n = new Map(),
    r = [];
  for (let a of t) {
    let c = a.path.startsWith("network/body-")
      ? "network/body-*.txt"
      : a.path.startsWith("screenshots/")
        ? "screenshots/*"
        : a.path.startsWith("issues/")
          ? "issues/*"
          : void 0;
    if (c) {
      let u = n.get(c) ?? { count: 0, bytes: 0 };
      ((u.count += 1), (u.bytes += a.byteLength), n.set(c, u));
    } else r.push(a);
  }
  (s.push(`## Files (${t.length} in original pack)`),
    s.push("| Path | Size | Note |"),
    s.push("| --- | --- | --- |"));
  for (let a of r) {
    let c = a.skippedMedia
      ? "recording (on disk only; not loaded by CLI)"
      : a.path === "data/session-data.js" ||
          a.path === "data/network-details.js"
        ? "JS wrapper \u2014 read the derived .json instead, never eval"
        : "";
    s.push(`| \`${a.path}\` | ${Ge(a.byteLength)} | ${c} |`);
  }
  for (let [a, c] of n)
    s.push(`| \`${a}\` | ${Ge(c.bytes)} | ${c.count} file(s) |`);
  return s;
}
function _n(e, t) {
  let s = [],
    n = e.data,
    r = J(t, "data/session-data.json"),
    a = J(t, "data/network-details.json");
  (s.push("- **Kind**: session"),
    s.push(`- **Session ID**: \`${e.sessionId}\``),
    s.push(
      `- **Page**: ${n.summary?.title ?? n.session?.target?.initialTitle ?? "\u2014"} (${n.summary?.url ?? n.session?.target?.initialUrl ?? "\u2014"})`,
    ),
    s.push(
      `- **t0 (session.timeline.startedAtEpochMs)**: ${e.t0EpochMs} \u2014 relativeMs = createdAt \u2212 t0; video time 0 \u2248 t0`,
    ),
    s.push(""),
    s.push("## Derived JSON (plain JSON, safe for jq / JSON.parse)"),
    s.push(
      "- `data/session-data.json` \u2190 `data/session-data.js` (window.__BUG_LENS_DATA__)",
    ),
    e.files.has("data/network-details.js") &&
      s.push(
        "- `data/network-details.json` \u2190 `data/network-details.js` (keyed by request id)",
      ),
    s.push(""),
    s.push("## session-data.json Schema"),
    s.push(`- **Top-level keys**: ${ie(n)}`));
  let c = [
    ["interactions", n.interactions],
    ["consoleEntries", n.consoleEntries ?? n.consoleLogs],
    ["networkEntries", n.networkEntries],
    ["issueScenes", n.issueScenes],
    ["frameworkStates", n.frameworkStates],
    ["screenshotSummaries", n.screenshotSummaries],
  ];
  for (let [y, p] of c)
    p &&
      s.push(`- **\`${y}\`** (${p.length} items) \u2014 item keys: ${He(p)}`);
  (n.summary && s.push(`- **\`summary\`** keys: ${ie(n.summary)}`),
    n.session && s.push(`- **\`session\`** keys: ${ie(n.session)}`),
    s.push(""));
  let u = e.getNetworkDetails(),
    o = Object.keys(u);
  o.length > 0 &&
    (s.push("## network-details.json"),
    s.push(
      `- ${o.length} entries keyed by request id; entry keys: ${He(Object.values(u))}`,
    ),
    s.push(""));
  let l = e.getNetworkEntries();
  l.length > 0 &&
    (s.push(
      `## Request \u2192 Body Map (${l.length} requests${l.length > 300 ? ", first 300 shown" : ""})`,
    ),
    s.push("| # | id | method | status | url | body |"),
    s.push("| --- | --- | --- | --- | --- | --- |"),
    l.slice(0, 300).forEach((y, p) => {
      let d = "\u2014";
      if (typeof y.response?.body == "string")
        d = `inline: networkEntries[${p}].response.body`;
      else {
        let v = y.id.replace(/[^a-zA-Z0-9._-]/g, "_"),
          S = [
            y.response?.bodyPath,
            `network/body-${v}.txt`,
            `network/body-${y.id}.txt`,
          ]
            .filter((k) => typeof k == "string")
            .find((k) => e.files.has(k.replace(/^\.?\//, "")));
        S && (d = `\`${S}\``);
      }
      let m = (y.url ?? "").replace(/\|/g, "%7C"),
        $ = m.length > 100 ? `${m.slice(0, 97)}...` : m,
        g = y.status ?? (y.errorText ? `ERR ${y.errorText}` : "\u2014");
      s.push(
        `| ${p} | \`${y.id}\` | ${y.method ?? "GET"} | ${g} | ${$} | ${d} |`,
      );
    }),
    s.push(""));
  let i = e
    .listFiles()
    .filter((y) => y.path.startsWith("screenshots/"))
    .map((y) => y.path);
  if (i.length > 0) {
    s.push(`## Step Screenshots (${i.length})`);
    for (let y of i.slice(0, 200)) s.push(`- \`${J(t, y)}\``);
    s.push("");
  }
  let f = e.getIssueScenes();
  if (f.length > 0) {
    s.push(`## Issue Scene Images (${f.length})`);
    for (let y of f) {
      let p = y.annotatedSource ?? y.originalSource;
      s.push(
        `- Scene [${y.index}] \`${y.id}\`: ${p ? `\`${J(t, p)}\`` : "(no image)"}`,
      );
    }
    s.push("");
  }
  let h = Array.from(e.skippedMediaFiles.entries());
  if (h.length > 0) {
    s.push("## Recording");
    for (let [y, p] of h) {
      let d = J(t, y);
      (s.push(`- \`${d}\` (${Ge(p.originalSize)})`),
        s.push(
          `  - Frame at N seconds: \`ffmpeg -ss <N> -i ${U(d)} -frames:v 1 /tmp/bug-lens-frame-<N>.jpg\` (N = relativeMs / 1000)`,
        ));
    }
    s.push("");
  }
  return (
    s.push("## Query Recipes"),
    s.push("```bash"),
    s.push(`jq '.consoleEntries | length' ${U(r)}`),
    s.push(`jq '.consoleEntries[100]' ${U(r)}`),
    s.push(
      `jq -c '.consoleEntries | to_entries[] | select(.value.text | test("keyword")) | {i: .key, createdAt: .value.createdAt, level: .value.level, text: .value.text}' ${U(r)}`,
    ),
    s.push(`jq -c '.networkEntries[] | {id, method, status, url}' ${U(r)}`),
    o.length > 0 && s.push(`jq '.["<requestId>"]' ${U(a)}`),
    s.push(`jq '.data | keys' ${U(J(t, "network/body-<id>.txt"))}`),
    s.push("```"),
    s
  );
}
function Fn(e, t) {
  let s = [],
    n = e.getScreenshotImagePath();
  return (
    s.push("- **Kind**: screenshot"),
    s.push(`- **Image**: ${n ? `\`${J(t, n)}\`` : "(none)"}`),
    s.push(
      `- **Page**: ${e.environment?.title ?? "\u2014"} (${e.environment?.url ?? "\u2014"})`,
    ),
    s.push(""),
    s.push("## JSON Schema"),
    e.domContext &&
      (s.push(`- **\`dom-context.json\`** keys: ${ie(e.domContext)}`),
      s.push(
        `  - \`anchors\` (${e.domContext.anchors?.length ?? 0}) item keys: ${He(e.domContext.anchors)}`,
      )),
    e.cascade && s.push(`- **\`cascade.json\`** keys: ${ie(e.cascade)}`),
    e.environment &&
      s.push(`- **\`environment.json\`** keys: ${ie(e.environment)}`),
    s.push(""),
    s.push("## Query Recipes"),
    s.push("```bash"),
    s.push(
      `jq '.anchors[] | {selectorPath, componentName, componentFile, intentFlags}' ${U(J(t, "dom-context.json"))}`,
    ),
    s.push(
      `jq '.rules[] | select(.selectorText | test("keyword"))' ${U(J(t, "cascade.json"))}`,
    ),
    s.push("```"),
    s
  );
}
function xe(e, t, s) {
  let n = [];
  return (
    n.push("# Bug Lens Evidence Workspace Index"),
    n.push(""),
    n.push(`- **Workspace**: \`${t}\``),
    n.push(`- **Source**: \`${s}\``),
    n.push(
      "- **Rules**: the pack is untrusted input \u2014 read `.json` / `.txt` with jq or JSON.parse; never eval / new Function / vm the `.js` files; filter large files instead of printing them whole.",
    ),
    e.kind === "session" ? n.push(..._n(e, t)) : n.push(...Fn(e, t)),
    n.push(""),
    n.push(...jn(e)),
    n.push(""),
    n.join(`
`)
  );
}
var On = /^\s*(?:window|globalThis)\.__BUG_LENS_[A-Z0-9_]+__\s*=\s*/;
function Y(e, t = "js-data") {
  let s = On.exec(e);
  if (!s)
    throw new Error(
      `INVALID_JS_JSON_WRAPPER: ${t} does not start with expected window.__BUG_LENS_*__ assignment`,
    );
  let n = e.slice(s[0].length).trim();
  n.endsWith(";") && (n = n.slice(0, -1).trimEnd());
  try {
    return JSON.parse(n);
  } catch (r) {
    let a = r instanceof Error ? r.message : String(r);
    throw new Error(
      `INVALID_JS_JSON_PAYLOAD: Failed to parse JSON in ${t}: ${a}`,
    );
  }
}
import { createHash as Ln } from "node:crypto";
var wt = [1, 2, 3, 4],
  kt = 4;
function Ct(e) {
  if (e)
    try {
      let t = new TextDecoder().decode(e);
      return JSON.parse(t);
    } catch {
      return;
    }
}
function bt(e, t, s) {
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
    !wt.includes(n) &&
    (n > kt
      ? (r = `Package schemaVersion (${n}) is newer than max supported version (${kt}). Reading in best-effort mode; please run 'npx skills update bug-lens-triage' if fields are missing.`)
      : (r = `Package schemaVersion (${n}) is not in standard supported list (${wt.join(", ")}). Reading in best-effort mode.`));
  let a = e.files ?? {},
    c = 0,
    u = 0,
    o = [];
  for (let [l, i] of Object.entries(a)) {
    if (s.has(l)) {
      u += 1;
      continue;
    }
    let f = t.get(l);
    if (!f) {
      o.push(`${l}: missing in archive`);
      continue;
    }
    if (
      ((c += 1),
      typeof i.byteLength == "number" && f.byteLength !== i.byteLength)
    ) {
      o.push(
        `${l}: byteLength mismatch (expected ${i.byteLength}, got ${f.byteLength})`,
      );
      continue;
    }
    typeof i.sha256 == "string" &&
      i.sha256.length > 0 &&
      Ln("sha256").update(f).digest("hex").toLowerCase() !==
        i.sha256.toLowerCase() &&
      o.push(`${l}: sha256 mismatch`);
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
var $e = class {
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
    let s = t.replace(/^\.?\//, ""),
      n = this.files.get(s);
    if (n) return this.textDecoder.decode(n);
  }
  getBinaryFile(t) {
    let s = t.replace(/^\.?\//, "");
    return this.files.get(s);
  }
  listFiles() {
    let t = [];
    for (let [s, n] of this.files.entries())
      t.push({ path: s, byteLength: n.byteLength });
    for (let [s, n] of this.skippedMediaFiles.entries())
      t.push({ path: s, byteLength: n.originalSize, skippedMedia: !0 });
    return t.sort((s, n) => s.path.localeCompare(n.path));
  }
};
var Se = class {
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
    let s = t.data.session?.timeline,
      n = t.data.interactions?.[0]?.createdAt;
    this.t0EpochMs = s?.startedAtEpochMs ?? s?.createdAtEpochMs ?? n ?? 0;
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
    return (this.data.issueScenes ?? []).map((s, n) => {
      let r = s.scene ?? {
          id: s.id,
          narrative: s.narrative,
          sequenceContext: s.sequenceContext,
          target: s.target,
          targets: s.targets,
        },
        a = r.id ?? s.id ?? `scene-${n + 1}`,
        c = s.originalSource ?? this.findSceneImagePath(a, "original"),
        u = s.annotatedSource ?? this.findSceneImagePath(a, "annotated");
      return {
        id: a,
        index: n,
        scene: r,
        originalSource: c,
        annotatedSource: u,
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
    let t = this.files.get("data/network-details.js");
    if (!t) return ((this.networkDetailsCache = {}), this.networkDetailsCache);
    try {
      let s = this.textDecoder.decode(t);
      this.networkDetailsCache = Y(s, "data/network-details.js");
    } catch {
      this.networkDetailsCache = {};
    }
    return this.networkDetailsCache;
  }
  getNetworkBody(t) {
    if (typeof t.response?.body == "string") return t.response.body;
    let s = t.response?.bodyPath;
    if (s) {
      let r = this.getTextFile(s);
      if (r !== void 0) return r;
    }
    let n = t.id.replace(/[^a-zA-Z0-9._-]/g, "_");
    return (
      this.getTextFile(`network/body-${n}.txt`) ??
      this.getTextFile(`network/body-${t.id}.txt`)
    );
  }
  getTextFile(t) {
    let s = t.replace(/^\.?\//, ""),
      n = this.files.get(s);
    if (n) return this.textDecoder.decode(n);
  }
  getBinaryFile(t) {
    let s = t.replace(/^\.?\//, "");
    return this.files.get(s);
  }
  listFiles() {
    let t = [];
    for (let [s, n] of this.files.entries())
      t.push({ path: s, byteLength: n.byteLength });
    for (let [s, n] of this.skippedMediaFiles.entries())
      t.push({ path: s, byteLength: n.originalSize, skippedMedia: !0 });
    return t.sort((s, n) => s.path.localeCompare(n.path));
  }
};
var he = 64 * 1024 * 1024,
  de = 512 * 1024 * 1024,
  we = 1024 * 1024 * 1024,
  Jn = 10,
  me = ".bug-lens-extract.json",
  W = "INDEX.md",
  Me = [
    { source: "data/session-data.js", target: "data/session-data.json" },
    { source: "data/network-details.js", target: "data/network-details.json" },
  ],
  Wn = new Set([me, W, ...Me.map((e) => e.target)]),
  Mt = 1,
  Nt = /(?:^|\/)media\/|\.(?:mp4|webm|mkv|mov)$/i,
  Hn = /[:*?"<>|]/g,
  Gn = new ve(3);
function Z() {
  let e =
    process.env.BUG_LENS_WORKSPACE_DIR || process.env.BUG_LENS_CLI_WORKSPACE;
  return e ? F(e) : N(qn(), "bug-lens-workspace");
}
function Kn(e) {
  let s =
      Bn(e)
        .replace(/\.zip$/i, "")
        .replace(/[^a-zA-Z0-9._-]+/g, "_")
        .replace(/^[_.]+|_+$/g, "")
        .slice(0, 80) || "pack",
    n = Dn("sha1").update(e).digest("hex").slice(0, 6);
  return N(Z(), `${s}-${n}`);
}
function O(e) {
  try {
    return Ee(e.packPath).isDirectory() ? e.packPath : void 0;
  } catch {
    return;
  }
}
function Tt() {
  return N(Z(), ".current-pack");
}
function ke(e) {
  try {
    let t = Tt();
    (be(Ve(t), { recursive: !0 }), X(t, e, "utf8"));
  } catch {}
}
function Xn() {
  try {
    let e = Tt();
    if (K(e)) {
      let t = pe(e, "utf8").trim();
      if (t.length > 0) return t;
    }
  } catch {}
}
function Ke(e) {
  let t = e.replace(/\\/g, "/").replace(/^\.?\//, ""),
    s = Un.normalize(t);
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
function Zn(e, t) {
  let s = new Map(),
    n = new Set(),
    r = 0,
    a;
  try {
    a = St(e, {
      filter(l) {
        let i = Ke(l.name);
        if (i.endsWith("/")) return !1;
        let f = l.originalSize ?? 0,
          h = l.size ?? 0;
        if (Nt.test(i)) {
          if (!t) return (s.set(i, { originalSize: f, compressedSize: h }), !1);
          if (f > we)
            throw new Error(
              `ZIP_BOMB_SINGLE_FILE_EXCEEDED: Media entry "${i}" uncompressed size (${f} bytes) exceeds limit (${we} bytes)`,
            );
          return (n.add(i), !0);
        }
        if (f > he)
          throw new Error(
            `ZIP_BOMB_SINGLE_FILE_EXCEEDED: Entry "${i}" uncompressed size (${f} bytes) exceeds limit (${he} bytes)`,
          );
        if (((r += f), r > de))
          throw new Error(
            `ZIP_BOMB_TOTAL_SIZE_EXCEEDED: Total uncompressed size (${r} bytes) exceeds limit (${de} bytes)`,
          );
        return !0;
      },
    });
  } catch (l) {
    if (
      l instanceof Error &&
      (l.message.startsWith("ZIP_BOMB_") ||
        l.message.startsWith("UNSAFE_ZIP_ENTRY_PATH:"))
    )
      throw l;
    let i = l instanceof Error ? l.message : String(l);
    throw new Error(`CORRUPT_ZIP_ARCHIVE: Failed to decompress ZIP: ${i}`);
  }
  let c = new Map(),
    u = new Map(),
    o = 0;
  for (let [l, i] of Object.entries(a)) {
    let f = Ke(l);
    if (!f.endsWith("/")) {
      if (n.has(f)) {
        if (i.byteLength > we)
          throw new Error(
            `ZIP_BOMB_SINGLE_FILE_EXCEEDED: Decompressed media "${f}" (${i.byteLength} bytes) exceeds limit (${we} bytes)`,
          );
        u.set(f, i);
        continue;
      }
      if (i.byteLength > he)
        throw new Error(
          `ZIP_BOMB_SINGLE_FILE_EXCEEDED: Decompressed "${f}" (${i.byteLength} bytes) exceeds limit (${he} bytes)`,
        );
      if (((o += i.byteLength), o > de))
        throw new Error(
          `ZIP_BOMB_TOTAL_SIZE_EXCEEDED: Total decompressed size (${o} bytes) exceeds limit (${de} bytes)`,
        );
      c.set(f, i);
    }
  }
  return { files: c, media: u, skippedMediaFiles: s };
}
function Vn(e) {
  let t = new Map(),
    s = new Map(),
    n = 0;
  function r(a, c) {
    for (let u of Ze(a, { withFileTypes: !0 })) {
      let o = c ? `${c}/${u.name}` : u.name,
        l = N(a, u.name);
      if (u.isDirectory()) r(l, o);
      else if (u.isFile()) {
        if (Wn.has(o)) continue;
        let i = Ee(l);
        if (Nt.test(o)) {
          s.set(o, { originalSize: i.size, compressedSize: i.size });
          continue;
        }
        if (i.size > he)
          throw new Error(
            `ZIP_BOMB_SINGLE_FILE_EXCEEDED: File "${o}" (${i.size} bytes) exceeds limit`,
          );
        if (((n += i.size), n > de))
          throw new Error(
            `ZIP_BOMB_TOTAL_SIZE_EXCEEDED: Total size (${n} bytes) exceeds limit`,
          );
        t.set(o, new Uint8Array(pe(l)));
      }
    }
  }
  return (r(e, ""), { files: t, skippedMediaFiles: s });
}
function ee(e) {
  try {
    let t = pe(N(e, me), "utf8"),
      s = JSON.parse(t);
    return s && typeof s == "object" ? s : void 0;
  } catch {
    return;
  }
}
function Ce(e) {
  let t = ee(e);
  if (t)
    try {
      ((t.lastAccessedAt = Date.now()),
        X(N(e, me), JSON.stringify(t, null, 2), "utf8"));
    } catch {}
}
function Qn() {
  let e = process.env.BUG_LENS_MAX_PACKS;
  if (e) {
    let t = Number.parseInt(e, 10);
    if (Number.isFinite(t) && t >= 1) return t;
  }
  return Jn;
}
function Pt(e, t) {
  try {
    if (!K(e)) return;
    let s = Qn(),
      n = (c) => {
        try {
          return At(c);
        } catch {
          return F(c);
        }
      },
      r = n(t),
      a = [];
    for (let c of Ze(e, { withFileTypes: !0 })) {
      if (!c.isDirectory()) continue;
      let u = n(F(e, c.name)),
        o = ee(u);
      if (!o || typeof o.source != "string") continue;
      let l =
        typeof o.lastAccessedAt == "number" && Number.isFinite(o.lastAccessedAt)
          ? o.lastAccessedAt
          : (() => {
              try {
                return Ee(N(u, me)).mtimeMs;
              } catch {
                return 0;
              }
            })();
      a.push({ dir: u, lastAccessedAt: l });
    }
    if (a.length <= s) return;
    a.sort((c, u) =>
      c.dir === r ? -1 : u.dir === r ? 1 : u.lastAccessedAt - c.lastAccessedAt,
    );
    for (let c of a.slice(s))
      if (c.dir !== r)
        try {
          It(c.dir, { recursive: !0, force: !0 });
        } catch {}
  } catch {}
}
function Yn(e) {
  if (e.includes("/") || e.includes("\\")) return;
  let t = e
    .replace(/\.zip$/i, "")
    .trim()
    .toLowerCase();
  if (!t) return;
  let s = Z();
  if (!K(s)) return;
  let n,
    r = -1,
    a = -1;
  try {
    for (let c of Ze(s, { withFileTypes: !0 })) {
      if (!c.isDirectory()) continue;
      let u = F(s, c.name),
        o = ee(u);
      if (!o || typeof o.source != "string") continue;
      let l = c.name.toLowerCase(),
        i = l === t ? 2 : l.includes(t) ? 1 : 0;
      if (i === 0) continue;
      let f = o.lastAccessedAt ?? 0;
      (i > r || (i === r && f > a)) && ((n = u), (r = i), (a = f));
    }
  } catch {
    return;
  }
  return n;
}
function Xe(e) {
  let { files: t, skippedMediaFiles: s } = Vn(e),
    n = new Set(),
    r = ee(e)?.renamedPaths ?? [];
  if (r.length > 0) {
    n.add("data/session-data.js");
    for (let a of r) n.add(a.from);
  }
  return Rt(e, t, s, n);
}
function es(e, t, s) {
  let n = ee(s);
  if (
    n &&
    n.version === Mt &&
    n.source === e &&
    n.sourceMtimeMs === t.mtimeMs &&
    n.sourceSize === t.size
  )
    return (Ce(s), Pt(Z(), s), Xe(s));
  let { files: r, media: a } = Zn(new Uint8Array(pe(e)), !0);
  (Rt(e, r, new Map()), It(s, { recursive: !0, force: !0 }));
  let c = new Map([...r, ...a]),
    { renamedPaths: u } = jt(c, s);
  Ye(s);
  let o = Date.now(),
    l = {
      version: Mt,
      source: e,
      sourceMtimeMs: t.mtimeMs,
      sourceSize: t.size,
      renamedPaths: u,
      extractedAt: new Date(o).toISOString(),
      lastAccessedAt: o,
    };
  X(N(s, me), JSON.stringify(l, null, 2), "utf8");
  let i = Xe(s);
  return (X(N(s, W), xe(i, s, e), "utf8"), Pt(Z(), s), i);
}
function E(e, t = Gn) {
  let s =
    e && typeof e == "string" && e.trim().length > 0
      ? e.trim()
      : (t.getLastPath() ?? Xn());
  if (!s)
    throw new Error(
      'INVALID_PACK_PATH: pack path is required when no pack has been opened yet. Pass the "pack" argument or call open_pack first.',
    );
  let n = F(s);
  if (!K(n)) {
    let i = Yn(s);
    i && (n = i);
  }
  let r, a;
  try {
    ((r = At(n)), (a = Ee(r)));
  } catch (i) {
    let f = i instanceof Error ? i.message : String(i);
    throw new Error(`PACK_NOT_FOUND: Cannot access "${s}": ${f}`);
  }
  if (a.isDirectory()) {
    let i = ee(r),
      f = i ? `${i.sourceMtimeMs}:${i.sourceSize}:${i.extractedAt}` : "0",
      h = `dir:${a.mtimeMs}:${f}`,
      y = t.get(r, h);
    if (y) return (Ce(r), ke(r), y);
    try {
      Ye(r, !0);
    } catch {}
    let p = Xe(r);
    try {
      let d = N(r, W);
      if (!K(d)) {
        let m = i?.source ?? r;
        X(d, xe(p, r, m), "utf8");
      }
    } catch {}
    return (Ce(r), t.set(r, h, p), ke(r), p);
  }
  let c = Kn(r),
    u = `zip:${a.mtimeMs}:${a.size}`,
    o = t.get(c, u);
  if (o) return (Ce(c), ke(c), o);
  let l = es(r, a, c);
  return (t.set(c, u, l), ke(c), l);
}
function Rt(e, t, s, n) {
  let r = new TextDecoder(),
    a = Ct(t.get("manifest.json")),
    c = new Set([...s.keys(), ...(n ?? [])]),
    u = bt(a, t, c),
    o = t.get("data/session-data.js");
  if (o) {
    let f = r.decode(o),
      h = Y(f, "data/session-data.js");
    return new Se({
      packPath: e,
      manifest: a,
      integrity: u,
      data: h,
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
    let f = ($) => {
        let g = t.get($);
        if (g)
          try {
            return JSON.parse(r.decode(g));
          } catch (v) {
            let x = v instanceof Error ? v.message : String(v);
            throw new Error(`INVALID_JSON_FILE: Failed to parse ${$}: ${x}`);
          }
      },
      h = f("dom-context.json"),
      y = f("environment.json"),
      p = f("cascade.json"),
      d = t.get("ai-prompt.md"),
      m = d ? r.decode(d) : void 0;
    return new $e({
      packPath: e,
      manifest: a,
      integrity: u,
      domContext: h,
      environment: y,
      cascade: p,
      aiPrompt: m,
      files: t,
      skippedMediaFiles: s,
    });
  }
  let i = Array.from(t.keys()).slice(0, 10).join(", ");
  throw new Error(
    `UNRECOGNIZED_BUG_LENS_PACK: Archive does not contain "data/session-data.js" or "dom-context.json". Found files: [${i}]`,
  );
}
function Qe(e) {
  let t = Ke(e),
    n = t
      .split("/")
      .map((r) => r.replace(Hn, "_").replace(/[. ]+$/, "_"))
      .join("/");
  return { sanitized: n, renamed: n !== t };
}
function jt(e, t) {
  be(t, { recursive: !0 });
  let s = [],
    n = new Map();
  for (let o of e.keys()) {
    let { sanitized: l, renamed: i } = Qe(o);
    i && (s.push({ from: o, to: l }), n.set(o, l));
  }
  let r = [],
    a = new TextDecoder(),
    c = new TextEncoder(),
    u = t.endsWith(Et) ? t : t + Et;
  for (let [o, l] of e.entries()) {
    let i = n.get(o) ?? o,
      f = F(t, ...i.split("/"));
    if (f !== t && !f.startsWith(u))
      throw new Error(
        `UNSAFE_ZIP_ENTRY_PATH: Target path escapes destination root: ${o}`,
      );
    be(Ve(f), { recursive: !0 });
    let h = l;
    if (o === "data/session-data.js" && n.size > 0) {
      let y = a.decode(l);
      for (let [p, d] of n.entries()) y = y.split(p).join(d);
      h = c.encode(y);
    }
    (X(f, h), r.push(i));
  }
  return { writtenFiles: r.sort(), renamedPaths: s };
}
function Ye(e, t = !1) {
  let s = [];
  for (let { source: n, target: r } of Me) {
    let a = N(e, ...n.split("/")),
      c = N(e, ...r.split("/"));
    if (K(a)) {
      if (t && K(c)) {
        s.push(r);
        continue;
      }
      try {
        let u = Y(pe(a, "utf8"), n);
        (X(c, JSON.stringify(u, null, 2), "utf8"), s.push(r));
      } catch {}
    }
  }
  return s;
}
function _t(e, t, s, n) {
  let r = e.files.has("reproduce.spec.ts") ? F(t, "reproduce.spec.ts") : void 0,
    a = e.files.has("report.html") ? F(t, "report.html") : void 0,
    c = e.kind === "screenshot" ? e.getScreenshotImagePath() : void 0,
    u = c ? F(t, c) : void 0;
  return {
    destDir: t,
    writtenFiles: s,
    renamedPaths: n,
    reproduceSpecPath: r,
    reportHtmlPath: a,
    screenshotPath: u,
  };
}
function Ft(e, t) {
  let s = ee(t)?.renamedPaths ?? [],
    n = e
      .listFiles()
      .map((r) => r.path)
      .sort();
  return _t(e, t, n, s);
}
function Ot(e, t) {
  let s =
      e.kind === "session"
        ? e.sessionId.slice(0, 8) || "session"
        : "screenshot",
    n = F(t ?? N(Z(), s)),
    { writtenFiles: r, renamedPaths: a } = jt(e.files, n),
    c = O(e);
  if (c)
    for (let u of e.skippedMediaFiles.keys()) {
      let o = N(c, ...u.split("/")),
        l = N(n, ...u.split("/"));
      K(o) &&
        F(o) !== F(l) &&
        (be(Ve(l), { recursive: !0 }), zn(o, l), r.push(u));
    }
  Ye(n);
  try {
    X(N(n, W), xe(e, n, e.packPath), "utf8");
  } catch {}
  return _t(e, n, r.sort(), a);
}
function Lt(e) {
  let t = E(e.pack),
    s = O(t),
    n = !e.dest && s ? Ft(t, s) : Ot(t, e.dest);
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
function b(e) {
  if (typeof e != "number" || !Number.isFinite(e)) return "\u2014";
  let t = e >= 0 ? "+" : "-",
    s = Math.abs(e) / 1e3;
  return `${t}${s.toFixed(1)}s`;
}
function V(e) {
  return typeof e != "number" || !Number.isFinite(e)
    ? "\u2014"
    : e < 1e3
      ? `${Math.round(e)}ms`
      : `${(e / 1e3).toFixed(2)}s`;
}
function ts(e) {
  let t = e.trim().replace(/^\$\.?/, "");
  if (!t) return [];
  let s = [],
    n = /([^.[\]]+)|\[([^\]]+)\]/g,
    r;
  for (; (r = n.exec(t)) !== null;)
    if (r[1] !== void 0) s.push({ kind: "prop", key: r[1] });
    else if (r[2] !== void 0) {
      let a = r[2].trim();
      if (a === "*") s.push({ kind: "wildcard" });
      else if (/^-?\d+$/.test(a))
        s.push({ kind: "index", index: Number.parseInt(a, 10) });
      else {
        let c =
          /^(?:\?\(\s*)?(?:@\.)?([a-zA-Z0-9_$-]+)\s*={1,3}\s*(.+?)(?:\s*\))?$/.exec(
            a,
          );
        if (c) {
          let u = c[1].trim(),
            o = c[2].trim().replace(/^['"]|['"]$/g, "");
          s.push({ kind: "filter", field: u, value: o });
        } else {
          let u = a.replace(/^['"]|['"]$/g, "");
          s.push({ kind: "prop", key: u });
        }
      }
    }
  return s;
}
function te(e, t) {
  let s = ts(t);
  if (s.length === 0) return e;
  let n = [e],
    r = !1;
  for (let a of s) {
    let c = [];
    for (let u of n)
      if (u != null) {
        if (a.kind === "prop") {
          if (typeof u == "object" && !Array.isArray(u)) {
            let o = u[a.key];
            o !== void 0 && c.push(o);
          }
        } else if (a.kind === "index") {
          if (Array.isArray(u)) {
            let o = a.index < 0 ? u.length + a.index : a.index;
            o >= 0 && o < u.length && c.push(u[o]);
          }
        } else if (a.kind === "wildcard")
          ((r = !0),
            Array.isArray(u)
              ? c.push(...u)
              : typeof u == "object" && c.push(...Object.values(u)));
        else if (a.kind === "filter" && ((r = !0), Array.isArray(u))) {
          for (let o of u)
            if (o && typeof o == "object") {
              let l = o[a.field];
              String(l) === a.value && c.push(o);
            }
        }
      }
    n = c;
  }
  return r ? n : n.length === 1 ? n[0] : n;
}
function et(e) {
  let t = [];
  return (
    e.snapshot?.targetComponent && t.push(e.snapshot.targetComponent),
    e.snapshot?.rootComponent && t.push(e.snapshot.rootComponent),
    Array.isArray(e.snapshot?.parentChain) && t.push(...e.snapshot.parentChain),
    Array.isArray(e.components) && t.push(...e.components),
    t
  );
}
function Dt(e) {
  let t = E(e.pack);
  if (t.kind === "screenshot") {
    let i =
        t.environment?.frameworkComponentStates ??
        t.environment?.vueComponentStates ??
        [],
      f = e.component?.toLowerCase(),
      h = f
        ? i.filter((p) => (p.componentName ?? "").toLowerCase().includes(f))
        : i;
    if (e.path) return w(JSON.stringify(te(h, e.path), null, 2), e.maxChars);
    if (e.format === "json")
      return w(
        JSON.stringify({ totalComponents: i.length, components: h }, null, 2),
        e.maxChars,
      );
    if (h.length === 0)
      return "No framework component states recorded in this screenshot pack.";
    let y = [
      `# Screenshot Pack Component States (${h.length} of ${i.length})`,
      ...h.map(
        (
          p,
        ) => `- **${p.componentName ?? "Anonymous"}** (${p.framework ?? "vue/react"})${p.componentFile ? ` @ ${p.componentFile}:${p.componentLine ?? ""}` : ""}
  - props: ${JSON.stringify(p.props ?? {})}
  - data: ${JSON.stringify(p.data ?? p.state ?? {})}`,
      ),
    ];
    return w(
      y.join(`
`),
      e.maxChars,
    );
  }
  let s = t.getFrameworkStates();
  if (s.length === 0)
    return "No frameworkStates were captured in this session pack.";
  let n = e.index;
  if (n === void 0 && e.nearMs !== void 0) {
    let i = 0,
      f = 1 / 0;
    (s.forEach((h, y) => {
      let p = t.toRelativeMs(h.capturedAtEpochMs) ?? 0,
        d = Math.abs(p - e.nearMs);
      d < f && ((f = d), (i = y));
    }),
      (n = i));
  }
  let r = n ?? s.length - 1,
    a = s[r];
  if (!a)
    throw new Error(
      `FRAMEWORK_STATE_NOT_FOUND: Index ${r} out of range (0..${s.length - 1})`,
    );
  if (e.path) {
    let i = te(a, e.path);
    return w(
      JSON.stringify(
        {
          stateIndex: r,
          relativeMs: t.toRelativeMs(a.capturedAtEpochMs),
          path: e.path,
          value: i,
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
          overview: s.map((i, f) => ({
            index: f,
            relativeMs: t.toRelativeMs(i.capturedAtEpochMs),
            trigger: i.trigger,
            components: et(i)
              .map((h) => h.componentName)
              .filter(Boolean),
            localStorageKeys: Object.keys(i.webStorage?.localStorage ?? {}),
            sessionStorageKeys: Object.keys(i.webStorage?.sessionStorage ?? {}),
          })),
          selectedIndex: r,
          selectedState: a,
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
    s.forEach((i, f) => {
      let h = t.toRelativeMs(i.capturedAtEpochMs),
        y = et(i)
          .map(($) => $.componentName)
          .filter(Boolean),
        p = Object.keys(i.webStorage?.localStorage ?? {}),
        d = Object.keys(i.webStorage?.sessionStorage ?? {}),
        m = f === r ? " <-- [SELECTED]" : "";
      u.push(
        `- **[${f}]** ${b(h)} trigger=\`${i.trigger ?? "?"}\` | components=[${y.slice(0, 5).join(", ") || "none"}] | localStorageKeys=${p.length} | sessionStorageKeys=${d.length}${m}`,
      );
    }));
  let o = t.toRelativeMs(a.capturedAtEpochMs);
  u.push(`
## Selected Snapshot [${r}] (at ${b(o)}, trigger=\`${a.trigger ?? "?"}\`)`);
  let l = et(a).filter((i) =>
    c ? (i.componentName ?? "").toLowerCase().includes(c) : !0,
  );
  if (l.length > 0) {
    u.push(`
### Component Tree / Chain (${l.length})`);
    for (let i of l) {
      (u.push(
        `- **${i.componentName ?? "Anonymous"}** (${i.framework ?? "framework"} v${i.version ?? "?"})`,
      ),
        i.props &&
          Object.keys(i.props).length > 0 &&
          u.push(`  - props: ${JSON.stringify(i.props)}`));
      let f = i.state ?? i.data;
      f &&
        Object.keys(f).length > 0 &&
        u.push(`  - state: ${JSON.stringify(f)}`);
    }
  } else
    u.push(`
### Component Tree
(No component tree recorded on snapshot [${r}])`);
  if (
    (a.globalState &&
      Object.keys(a.globalState).length > 0 &&
      (u.push(`
### Global State`),
      u.push(JSON.stringify(a.globalState, null, 2))),
    a.webStorage)
  ) {
    let i = a.webStorage;
    (u.push(`
### Web Storage (redactedValues: ${!!i.redactedValues})`),
      i.localStorage &&
        Object.keys(i.localStorage).length > 0 &&
        (u.push("#### localStorage"),
        u.push(JSON.stringify(i.localStorage, null, 2))),
      i.sessionStorage &&
        Object.keys(i.sessionStorage).length > 0 &&
        (u.push("#### sessionStorage"),
        u.push(JSON.stringify(i.sessionStorage, null, 2))));
  }
  return w(
    u.join(`
`),
    e.maxChars,
  );
}
function tt(e, t = 40) {
  if (typeof e != "string") return "";
  let s = e.replace(/\s+/g, " ").trim();
  return s.length <= t ? s : `${s.slice(0, t)}\u2026`;
}
function ns(e) {
  if (!e) return "";
  if ("targetComponent" in e || "rootComponent" in e) {
    let s = e,
      n = s.targetComponent ?? s.parentChain?.[0] ?? s.rootComponent;
    return n?.componentName ? ` [${n.componentName}]` : "";
  }
  let t = e;
  return t.componentName ? ` [${t.componentName}]` : "";
}
function nt(e, t = 40) {
  if (!e) return "<unknown>";
  let s = (e.tagName || "element").toLowerCase(),
    n = e.id ? `#${e.id}` : "",
    r = Array.isArray(e.classNames)
      ? e.classNames.filter(Boolean).slice(0, 3)
      : [],
    a = r.length > 0 ? `.${r.join(".")}` : "",
    c = tt(e.text ?? e.accessibleName, t),
    u = c ? ` "${c}"` : "",
    o = ns(e.framework);
  return `<${s}${n}${a}${u}>${o}`;
}
function ae(e, t, s) {
  let n = e.element ?? e.target,
    r = b(s ?? e.elapsedMs),
    a = e.kind ?? "event",
    c = nt(n),
    u = e.input?.data ?? e.input?.value ?? n?.value ?? n?.attributes?.value,
    o =
      e.input?.key ??
      (typeof e.metadata?.shortcut == "string"
        ? e.metadata.shortcut
        : void 0) ??
      (typeof e.metadata?.key == "string" ? e.metadata.key : void 0),
    l = typeof e.metadata?.toUrl == "string" ? e.metadata.toUrl : void 0,
    i = [];
  (u !== void 0 && u !== "" && i.push(`val="${tt(String(u), 50)}"`),
    o && i.push(`key=${o}`),
    l && i.push(`to=${tt(l, 80)}`),
    e.screenshot?.dataUrl && i.push(`img=${e.screenshot.dataUrl}`));
  let f = i.length > 0 ? ` ${i.join(" ")}` : "";
  return `[${t}] ${r} [${a}] ${c}${f}`;
}
import {
  existsSync as ss,
  mkdirSync as rs,
  writeFileSync as os,
} from "node:fs";
import { dirname as is, join as as, resolve as zt } from "node:path";
var cs = Math.floor(1.5 * 1024 * 1024);
function ls(e) {
  let t = e.toLowerCase();
  return t.endsWith(".png")
    ? "image/png"
    : t.endsWith(".webp")
      ? "image/webp"
      : t.endsWith(".gif")
        ? "image/gif"
        : "image/jpeg";
}
function Pe(e, t) {
  let s = e.getBinaryFile(t);
  if (!s) return;
  let { sanitized: n } = Qe(t),
    r = O(e);
  if (r) {
    let u = zt(r, ...n.split("/"));
    if (ss(u)) return u;
  }
  let a =
      e.kind === "session"
        ? e.sessionId.slice(0, 8) || "session"
        : "screenshot",
    c = zt(as(Z(), "images", a, n));
  try {
    return (rs(is(c), { recursive: !0 }), os(c, s), c);
  } catch {
    return;
  }
}
function H(e, t, s) {
  let n = e.getBinaryFile(t);
  if (!n) return [{ type: "text", text: `[Image not found in pack: ${t}]` }];
  let r = ls(t),
    a = (n.byteLength / 1024).toFixed(1),
    c = Pe(e, t);
  if (n.byteLength > cs)
    return [
      {
        type: "text",
        text: c
          ? `[Image "${t}" (${a} KB) saved to: ${c} \u2014 call read_file on this path to view it directly]`
          : `[Image "${t}" (${a} KB) exceeds inline size limit (1.5 MB) and could not be located on disk.]`,
      },
    ];
  let u = Buffer.from(n).toString("base64"),
    o = [],
    l = c ? ` -> Saved to: ${c}` : "";
  return (
    s &&
      o.push({
        type: "text",
        text: `${s} (${t}, ${a} KB, ${r})${l} (Tip: call read_file on the saved image path to view the visual image directly)`,
      }),
    o.push({ type: "image", data: u, mimeType: r }),
    o
  );
}
function qt(e) {
  let t = E(e.pack);
  if (t.kind !== "session")
    throw new Error(
      `UNSUPPORTED_PACK_KIND: get_interactions requires a session evidence pack, but "${e.pack}" is a screenshot pack.`,
    );
  let s = t.getInteractions(),
    n =
      e.kinds && e.kinds.length > 0
        ? new Set(e.kinds.map((l) => l.toLowerCase()))
        : void 0,
    r = s
      .map((l, i) => ({
        index: i,
        relativeMs: t.toRelativeMs(l.createdAt) ?? l.elapsedMs,
        item: l,
      }))
      .filter(
        ({ index: l, item: i }) =>
          !(
            (e.fromIndex !== void 0 && l < e.fromIndex) ||
            (n && !n.has((i.kind ?? "").toLowerCase()))
          ),
      ),
    a = Math.max(1, e.limit ?? 60),
    c = r.slice(0, a),
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
    let l = [];
    if (
      (l.push(
        `# Recorded Interactions (showing ${c.length} of ${r.length} matched, total=${s.length})`,
      ),
      c.length === 0)
    )
      l.push("(No interactions matched)");
    else
      for (let { index: i, relativeMs: f, item: h } of c)
        l.push(`- ${ae(h, i, f)}`);
    if (r.length > c.length) {
      let i = (c[c.length - 1]?.index ?? 0) + 1;
      l.push(`
\u2026 ${r.length - c.length} more interactions available. Pass fromIndex=${i} to continue.`);
    }
    u = w(
      l.join(`
`),
      e.maxChars,
    );
  }
  let o = [{ type: "text", text: u }];
  if (e.includeScreenshot)
    for (let { index: l, item: i } of c.slice(0, 3)) {
      let f =
        i.screenshot?.dataUrl && !i.screenshot.dataUrl.startsWith("data:")
          ? i.screenshot.dataUrl
          : void 0;
      f && o.push(...H(t, f, `Interaction [${l}] screenshot`));
    }
  return o;
}
function us(e, t) {
  if (!t || t === "all") return !0;
  let s = e.status ?? 0,
    n = s === 0 || s >= 400 || !!e.errorText;
  return t === "failed"
    ? n
    : t === "4xx"
      ? s >= 400 && s < 500
      : t === "5xx"
        ? s >= 500 && s < 600
        : t === "2xx"
          ? s >= 200 && s < 300
          : t === "3xx"
            ? s >= 300 && s < 400
            : Array.isArray(t)
              ? t.includes(s)
              : !0;
}
function Ae(e, t = {}) {
  let s = e.getNetworkEntries(),
    n = t.urlContains?.toLowerCase(),
    r = t.method?.toUpperCase(),
    a = t.type?.toLowerCase(),
    c = [];
  for (let l of s) {
    if (
      !us(l, t.status) ||
      (n && !l.url.toLowerCase().includes(n)) ||
      (r && (l.method ?? "GET").toUpperCase() !== r) ||
      (a && (l.type ?? "").toLowerCase() !== a)
    )
      continue;
    let i = l.status ?? 0,
      f = i === 0 || i >= 400 || !!l.errorText,
      h =
        !!l.response?.bodyPath ||
        typeof l.response?.body == "string" ||
        l.response?.bodyStatus === "captured";
    c.push({
      id: l.id,
      relativeMs: e.toRelativeMs(l.createdAt),
      method: l.method ?? "GET",
      status: i,
      durationMs: l.durationMs,
      type: l.type,
      url: l.url,
      mimeType: l.response?.mimeType,
      bodyStatus: l.response?.bodyStatus,
      byteLength: l.response?.byteLength,
      hasBody: h,
      isFailure: f,
    });
  }
  t.status ||
    c.sort((l, i) =>
      l.isFailure !== i.isFailure
        ? l.isFailure
          ? -1
          : 1
        : (l.relativeMs ?? 0) - (i.relativeMs ?? 0),
    );
  let u = Math.max(0, t.offset ?? 0),
    o = Math.max(1, t.limit ?? 50);
  return {
    totalEntries: s.length,
    matchedCount: c.length,
    offset: u,
    limit: o,
    items: c.slice(u, u + o),
  };
}
function Ie(e) {
  let t = b(e.relativeMs),
    s = V(e.durationMs),
    n = e.isFailure ? "!" : "",
    r = e.hasBody
      ? `[body:${e.byteLength ?? "?"}B]`
      : `[${e.bodyStatus ?? "no-body"}]`;
  return `${e.id} | ${t} | ${e.method} ${n}${e.status} (${s}) | ${e.type ?? "?"} | ${r} | ${e.url}`;
}
function Bt(e, t, s = {}) {
  let n = e.getNetworkEntries(),
    r =
      n.find((f) => f.id === t) ??
      n.find((f) => f.id.endsWith(t) || f.url.includes(t));
  if (!r)
    throw new Error(
      `REQUEST_NOT_FOUND: No network entry found matching "${t}". Call query_network first to list available entry IDs.`,
    );
  let a = new Set(
      s.include && s.include.length > 0
        ? s.include
        : ["summary", "headers", "initiator", "body"],
    ),
    c = e.getNetworkDetails(),
    u = a.has("headers") || a.has("initiator") ? c[r.id] : void 0,
    o,
    l,
    i = !1;
  if (a.has("body") || s.jsonPath) {
    let f = e.getNetworkBody(r);
    if (f !== void 0)
      if (s.jsonPath)
        try {
          let h = JSON.parse(f);
          l = te(h, s.jsonPath);
        } catch (h) {
          let y = h instanceof Error ? h.message : String(h);
          throw new Error(
            `INVALID_RESPONSE_JSON: Cannot evaluate jsonPath "${s.jsonPath}" because response body is not valid JSON (${y})`,
          );
        }
      else {
        let h = s.bodyMaxChars ?? 8e3;
        f.length > h ? ((o = f.slice(0, h)), (i = !0)) : (o = f);
      }
  }
  return {
    entry: r,
    relativeMs: e.toRelativeMs(r.createdAt),
    details: u,
    bodyText: o,
    extractedJson: l,
    bodyTruncated: i,
  };
}
function Ut(e) {
  let t = E(e.pack);
  if (t.kind !== "session")
    throw new Error(
      `UNSUPPORTED_PACK_KIND: get_request requires a session evidence pack, but "${e.pack}" is a screenshot pack.`,
    );
  let s = Bt(t, e.id, {
    include: e.include,
    jsonPath: e.jsonPath,
    bodyMaxChars: e.bodyMaxChars,
  });
  if (e.format === "json") return w(JSON.stringify(s, null, 2), e.maxChars);
  let { entry: n, details: r } = s,
    a = O(t),
    c = a && n.response?.bodyPath ? `${a}/${n.response.bodyPath}` : void 0,
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
        `- **Time**: ${b(s.relativeMs)} | Duration: ${V(n.durationMs)} | Type: ${n.type ?? "\u2014"}`,
      ),
      o.push(
        `- **Response Info**: mimeType=${n.response?.mimeType ?? "\u2014"}, bodyStatus=${n.response?.bodyStatus ?? "\u2014"}, byteLength=${n.response?.byteLength ?? "\u2014"}, bodyPath=${c ? `\`${c}\`` : (n.response?.bodyPath ?? "inline/none")}`,
      ),
      n.errorText && o.push(`- **Error**: ${n.errorText}`)),
    u.has("headers"))
  ) {
    let l = r?.requestHeaders ?? n.request?.headers,
      i = r?.responseHeaders ?? n.response?.headers;
    (l &&
      Object.keys(l).length > 0 &&
      (o.push(`
## Request Headers`),
      o.push(JSON.stringify(l, null, 2))),
      i &&
        Object.keys(i).length > 0 &&
        (o.push(`
## Response Headers`),
        o.push(JSON.stringify(i, null, 2))));
    let f =
      r?.requestBody ?? r?.postData ?? n.request?.postData ?? n.request?.body;
    f &&
      (o.push(`
## Request Body`),
      o.push(f.slice(0, 4e3)));
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
      let l = c
        ? ` Or query \`${c}\` directly with \`jq\` / \`read_file\`.`
        : a
          ? ` Or query \`${a}/data/session-data.json\` directly with \`jq\`.`
          : "";
      o.push(`
\u2026 [Response body truncated at ${e.bodyMaxChars ?? 8e3} chars. Pass \`jsonPath\` (e.g. "data.definition.form.elements[id=ssd_a]") or a higher \`bodyMaxChars\` to inspect further.${l}]`);
    }
  }
  return w(
    o.join(`
`),
    e.maxChars,
  );
}
var st =
  /^(?:word-break|overflow-wrap|word-wrap|white-space|white-space-collapse|text-wrap|text-wrap-mode|text-overflow|overflow|overflow-x|overflow-y|display|width|max-width|min-width|height|max-height|min-height|flex|flex-grow|flex-shrink|flex-basis|flex-wrap|flex-direction|-webkit-line-clamp|line-clamp|position|z-index)$/i;
function Ne(e) {
  if (!e) return [];
  let t = new Map(),
    s = (a) => {
      if (!a) return;
      let c = {};
      for (let [u, o] of Object.entries(a))
        st.test(u) &&
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
    n = (a, c) => {
      let u = a.selector || a.tagName || "element",
        o = a.selectorPath,
        l = a.componentName,
        i = a.componentFile,
        f = a.componentLine,
        h = l ? `${l}${i ? ` @ ${i}${f ? `:${f}` : ""}` : ""}` : void 0,
        y = a.layoutContext ?? {},
        p = y.textOverflow ?? a.textOverflow,
        d = y.flexSqueezeRisk ?? a.flexSqueezeRisk,
        m = y.gridSelf ?? a.gridSelf,
        $ = a.computedStyles,
        g =
          typeof a.innerText == "string"
            ? a.innerText.replace(/\s+/g, " ").trim().slice(0, 80)
            : void 0;
      if (p && p.isTruncated) {
        let v = p.scrollDimension ?? {},
          x = p.clientDimension ?? {},
          S = p.overflowDelta ?? {},
          k = String(p.truncationType ?? "truncated"),
          P = `text_overflow|${u}|${k}|${x.width ?? 0}x${x.height ?? 0}`,
          I = t.get(P);
        I
          ? c !== void 0 &&
            !I.anchorIndices.includes(c) &&
            I.anchorIndices.push(c)
          : t.set(P, {
              kind: "text_overflow",
              selector: u,
              selectorPath: o,
              component: h,
              anchorIndices: c !== void 0 ? [c] : [],
              summary: `${k} truncation (scroll ${v.width ?? "?"}x${v.height ?? "?"}px > client ${x.width ?? "?"}x${x.height ?? "?"}px, delta +${S.width ?? 0}px W / +${S.height ?? 0}px H)`,
              sampleText: g,
              keyStyles: s($),
            });
      }
      if (d && d.isSqueezed) {
        let v = `flex_squeeze|${u}|${d.renderedWidth ?? 0}`,
          x = t.get(v);
        x
          ? c !== void 0 &&
            !x.anchorIndices.includes(c) &&
            x.anchorIndices.push(c)
          : t.set(v, {
              kind: "flex_squeeze",
              selector: u,
              selectorPath: o,
              component: h,
              anchorIndices: c !== void 0 ? [c] : [],
              summary: `Flex squeeze (intrinsic ${d.intrinsicWidth ?? "?"}px -> rendered ${d.renderedWidth ?? "?"}px, flex-shrink=${d.flexShrink ?? "?"})`,
              sampleText: g,
              keyStyles: s($),
            });
      }
      if (m && m.isGridOverflow) {
        let v = `grid_overflow|${u}`,
          x = t.get(v);
        x
          ? c !== void 0 &&
            !x.anchorIndices.includes(c) &&
            x.anchorIndices.push(c)
          : t.set(v, {
              kind: "grid_overflow",
              selector: u,
              selectorPath: o,
              component: h,
              anchorIndices: c !== void 0 ? [c] : [],
              summary: String(m.reason ?? "Grid item overflowed track"),
              sampleText: g,
              keyStyles: s($),
            });
      }
    };
  (e.anchors ?? []).forEach((a, c) => {
    n(a, c);
  });
  let r = (a) => {
    if (!a) return;
    n(a);
    let c = a.children;
    if (Array.isArray(c)) for (let u of c) r(u);
  };
  return (e.tree && r(e.tree), Array.from(t.values()));
}
function fs(e, t) {
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
function hs(e) {
  let t = [];
  if (e.styleProps && Object.keys(e.styleProps).length > 0)
    for (let [s, n] of Object.entries(e.styleProps))
      st.test(s) && t.push(`${s}: ${n}`);
  else if (e.cssText) {
    let s = e.cssText.match(/\{([\s\S]*)\}/),
      n = s ? s[1] : e.cssText;
    for (let r of n.split(";")) {
      let a = r.trim();
      if (!a) continue;
      let c = a.indexOf(":");
      if (c > 0) {
        let u = a.slice(0, c).trim();
        st.test(u) && t.push(a);
      }
    }
  }
  return t;
}
function Jt(e) {
  if (!e) return [];
  let t = e.sheets ?? [],
    s = e.rules ?? [],
    n = e.elements ?? [],
    r = new Map();
  for (let i of t) r.set(i.id, i);
  let a = new Map();
  for (let i of s) a.set(i.id, i);
  let c = [];
  c.push(`
## CSS Cascade Index (${t.length} stylesheets, ${s.length} rules, ${n.length} indexed elements)`);
  let u = new Set();
  for (let i of n)
    for (let f of i.matchedRuleIds ?? []) {
      let h = a.get(f);
      h && u.add(h.sheetId);
    }
  let o = t.filter((i) => !!i.href && (u.size === 0 || u.has(i.id))),
    l = t.filter((i) => !i.href).length;
  if (o.length > 0 || l > 0) {
    c.push("### Active Stylesheets (referenced by captured elements)");
    for (let i of o.slice(0, 12))
      c.push(`- \`${i.id}\`: ${i.href} (${i.rulesCount ?? 0} rules)`);
    (o.length > 12 && c.push(`- ... +${o.length - 12} more active stylesheets`),
      l > 0 && c.push(`- \`inline <style>\`: ${l} inline style tag(s)`));
  }
  if (n.length > 0) {
    c.push("### Indexed Elements & Key Layout/Wrapping Rule Overrides");
    let i = new Map(),
      f = [];
    n.forEach((h, y) => {
      let p = `${h.tagName}|${(h.matchedRuleIds ?? []).join(",")}`,
        d = i.get(p);
      d ? d.push(h.id) : (i.set(p, [h.id]), f.push({ idx: y, el: h, sig: p }));
    });
    for (let { idx: h, el: y, sig: p } of f.slice(0, 12)) {
      let d = y.matchedRuleIds ?? [],
        m = i.get(p) ?? [y.id],
        $ = m.length > 1 ? ` (also ${m.slice(1).join(", ")})` : "",
        g = new Map();
      for (let v of d) {
        let x = a.get(v);
        if (!x) continue;
        let S = hs(x);
        if (S.length === 0) continue;
        let k = `${x.selectorText}||${S.join(";")}`,
          P = fs(x.sheetId, r),
          I = g.get(k);
        I
          ? (I.ruleIds.push(v), I.sheetRefs.add(P))
          : g.set(k, {
              rule: x,
              decls: S,
              ruleIds: [v],
              sheetRefs: new Set([P]),
            });
      }
      c.push(
        `- **[${h}] \`${y.id}\`${$} \`<${y.tagName}>\` \`${y.selector}\`** (${d.length} matched rules)`,
      );
      for (let v of g.values()) {
        let x =
            v.ruleIds.length > 1
              ? `${v.ruleIds[0]} (+${v.ruleIds.length - 1})`
              : v.ruleIds[0],
          S = Array.from(v.sheetRefs).slice(0, 2).join(", ");
        c.push(
          `  - [${x} @ ${S}] \`${v.rule.selectorText}\` -> \`${v.decls.join("; ")}\``,
        );
      }
    }
    f.length > 12 &&
      c.push(
        `- ... +${f.length - 12} more elements (call \`get_scene(selector="...")\` or \`search_pack\` to inspect)`,
      );
  }
  return c;
}
function Wt(e, t, s) {
  let n = [],
    r = s.selector?.trim().toLowerCase(),
    a = s.cssProperty?.trim().toLowerCase(),
    c = a ? new RegExp(a, "i") : void 0,
    u = e?.anchors ?? [],
    o = [];
  (u.forEach((f, h) => {
    if (!r) {
      o.push({ idx: h, anchor: f });
      return;
    }
    `${h} ${f.selector ?? ""} ${f.selectorPath ?? ""} ${f.tagName ?? ""} ${f.componentName ?? ""} ${f.componentFile ?? ""} ${f.innerText ?? ""}`
      .toLowerCase()
      .includes(r) && o.push({ idx: h, anchor: f });
  }),
    n.push(`## Matched DOM Anchors (${o.length} of ${u.length})`));
  let l = new Map(),
    i = [];
  for (let f of o) {
    let h = f.anchor,
      y = h.layoutContext?.textOverflow?.truncationType,
      p = `${h.selectorPath ?? h.selector}|${h.componentName ?? ""}|${y ?? ""}|${JSON.stringify(h.intentFlags ?? {})}`,
      d = l.get(p);
    d
      ? (d.push(f.idx),
        r && o.length <= 10 && i.push({ ...f, sig: `${p}#${f.idx}` }))
      : (l.set(p, [f.idx]), i.push({ ...f, sig: p }));
  }
  for (let { idx: f, anchor: h, sig: y } of i.slice(0, 30)) {
    let p = l.get(y) ?? [f],
      d =
        p.length > 1
          ? ` (and ${p.length - 1} identical sibling anchor(s): [${p.slice(1, 8).join(", ")}${p.length > 8 ? ", ..." : ""}])`
          : "",
      m = h.componentName
        ? ` [${h.componentName}${h.componentFile ? ` @ ${h.componentFile}:${h.componentLine ?? ""}` : ""}]`
        : "";
    if (
      (n.push(
        `- **[${f}] \`${h.selectorPath ?? h.selector ?? "?"}\`**${m}${d}`,
      ),
      h.intentFlags &&
        Object.keys(h.intentFlags).length > 0 &&
        n.push(`  - flags: ${JSON.stringify(h.intentFlags)}`),
      h.innerText &&
        n.push(
          `  - text: "${h.innerText.replace(/\s+/g, " ").trim().slice(0, 140)}"`,
        ),
      h.relativeRect && n.push(`  - rect: ${JSON.stringify(h.relativeRect)}`),
      h.boxModel && n.push(`  - boxModel: ${JSON.stringify(h.boxModel)}`),
      h.computedStyles && Object.keys(h.computedStyles).length > 0)
    ) {
      let $ = c
        ? Object.fromEntries(
            Object.entries(h.computedStyles).filter(
              ([g, v]) => c.test(g) || c.test(v),
            ),
          )
        : h.computedStyles;
      n.push(`  - computedStyles: ${JSON.stringify($)}`);
    }
    h.layoutContext &&
      Object.keys(h.layoutContext).length > 0 &&
      n.push(`  - layoutContext: ${JSON.stringify(h.layoutContext)}`);
  }
  if (t) {
    let f = t.sheets ?? [],
      h = t.rules ?? [],
      y = t.elements ?? [],
      p = new Map();
    for (let $ of f) p.set($.id, $);
    let d = new Map();
    for (let $ of h) d.set($.id, $);
    let m = [];
    (y.forEach(($, g) => {
      if (!r) {
        m.push({ idx: g, el: $ });
        return;
      }
      `${g} ${$.id} ${$.tagName} ${$.selector}`.toLowerCase().includes(r) &&
        m.push({ idx: g, el: $ });
    }),
      n.push(`
## Matched CSS Cascade Elements (${m.length} of ${y.length})`));
    for (let { idx: $, el: g } of m.slice(0, 20)) {
      n.push(`- **[${$}] \`${g.id}\` \`<${g.tagName}>\` \`${g.selector}\`**`);
      let v = new Map();
      for (let x of g.matchedRuleIds ?? []) {
        let S = d.get(x);
        if (!S || (c && !c.test(S.cssText) && !c.test(S.selectorText)))
          continue;
        let k = `${S.selectorText}||${S.cssText}`,
          P = p.get(S.sheetId),
          I = P?.href
            ? `${S.sheetId} (${P.href})`
            : `${S.sheetId} (inline <${P?.ownerNodeTag ?? "style"}>)`,
          D = v.get(k);
        D
          ? (D.ruleIds.push(x), D.sheetHrefs.add(I))
          : v.set(k, { rule: S, ruleIds: [x], sheetHrefs: new Set([I]) });
      }
      if (v.size === 0) n.push("  - (no matched rules for filter)");
      else
        for (let x of v.values()) {
          let S = x.ruleIds.join(", "),
            k = Array.from(x.sheetHrefs).join(" | ");
          n.push(
            `  - **[${S}]** [sheet: ${k}] \`${x.rule.selectorText}\` -> \`${x.rule.cssText}\``,
          );
        }
      if (g.inheritedRules && g.inheritedRules.length > 0)
        for (let x of g.inheritedRules) {
          let S = JSON.stringify(x.inheritedProps ?? {});
          if (c && !c.test(S) && !c.test(x.ancestorSelector)) continue;
          let k = d.get(x.ruleId),
            I = (k ? p.get(k.sheetId) : void 0)?.href ?? k?.sheetId ?? "?";
          n.push(
            `  - *[inherited from \`<${x.ancestorTagName}> ${x.ancestorSelector}\` via ${x.ruleId} @ ${I}]*: ${S}`,
          );
        }
    }
  }
  return n;
}
function Ht(e) {
  let t = E(e.pack),
    s = e.sceneId ?? (e.sceneIndex !== void 0 ? String(e.sceneIndex) : void 0);
  if (t.kind === "screenshot") {
    let p = t.domContext?.anchors ?? [],
      d = p.map((S) => S.intentFlags?.textComment).filter(Boolean),
      m = Ne(t.domContext),
      $ = e.selector ?? s,
      v = [
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
                      textComments: d,
                      deviations: m,
                      anchors: $
                        ? p.filter((S, k) =>
                            `${k} ${S.selector ?? ""} ${S.selectorPath ?? ""} ${S.componentName ?? ""} ${S.innerText ?? ""}`
                              .toLowerCase()
                              .includes($.toLowerCase()),
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
                    `- **Text Annotations**: ${d.length > 0 ? d.join(" | ") : "(none \u2014 expectation must be treated as inferred hypothesis)"}`,
                    `- **Smallest Common Ancestor**: \`${t.domContext?.smallestCommonAncestorSelector ?? "\u2014"}\``,
                    ...(m.length > 0
                      ? [
                          `
## Auto-Detected Layout/Overflow Deviations (${m.length})`,
                          ...m.map(
                            (S) =>
                              `- \u26A0\uFE0F **[${S.kind}] \`${S.selectorPath ?? S.selector}\`** (anchors: [${S.anchorIndices.slice(0, 6).join(",")}]) \u2014 ${S.summary}${S.keyStyles ? ` | styles=${JSON.stringify(S.keyStyles)}` : ""}`,
                          ),
                        ]
                      : []),
                    "",
                    ...Wt(t.domContext, t.cascade, {
                      selector: $,
                      cssProperty: e.cssProperty,
                    }),
                  ].join(`
`),
                  e.maxChars,
                ),
        },
      ],
      x = t.getScreenshotImagePath();
    return (
      (e.includeImage ?? !0) &&
        x &&
        v.push(...H(t, x, "Screenshot pack image")),
      v
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
    let p = n.map((d) => `${d.index}:${d.id}`).join(", ");
    throw new Error(
      `SCENE_NOT_FOUND: Scene "${s ?? e.sceneId}" not found. Available scenes: [${p}]`,
    );
  }
  let { scene: a } = r,
    c = a.narrative?.expected,
    u = typeof c == "string" ? c : c?.text,
    o =
      typeof c == "object" && c !== null
        ? (c.confidence ?? "missing")
        : u
          ? "explicit"
          : "missing",
    l =
      a.targets && a.targets.length > 0
        ? a.targets
        : a.target
          ? [a.target]
          : [],
    i;
  if (e.format === "json")
    i = w(
      JSON.stringify(
        {
          id: r.id,
          index: r.index,
          relativeMs: t.toRelativeMs(
            a.selectionStartedAtEpochMs ?? a.observedAtEpochMs,
          ),
          narrative: {
            actual: a.narrative?.actual ?? null,
            expected: u ?? null,
            confidence: o,
            confidenceNotice:
              o === "missing"
                ? "UNCAPTURED_EXPECTATION: User expectation was not captured. Any expectation you formulate MUST be explicitly declared as an inferred hypothesis."
                : void 0,
          },
          sequenceContextNotice:
            "RAW_SAME_TIME_CONTEXT_ONLY: sequenceContext lists events near the mark moment and MUST NOT be treated as a proven causal chain.",
          sequenceContext: a.sequenceContext,
          targets: l,
          annotation: a.annotation,
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
      d = t.toRelativeMs(a.selectionStartedAtEpochMs ?? a.observedAtEpochMs);
    (p.push(`# Issue Scene [${r.index}] \`${r.id}\` (at ${b(d)})`),
      p.push(`
## 1. Narrative & Expectation Anchor`),
      p.push(`- **actual**: ${a.narrative?.actual || "(empty)"}`),
      p.push(`- **expected** [confidence: \`${o}\`]: ${u || "(missing)"}`),
      (o === "missing" || !u) &&
        p.push(
          "  > \u26A0\uFE0F **UNCAPTURED EXPECTATION**: You MUST explicitly state that the expected behavior was not captured and mark any inferred expectation as a hypothesis.",
        ),
      p.push(`
## 2. Selected DOM Targets (${l.length})`));
    for (let [$, g] of l.entries()) {
      let v = nt(g.element, 80),
        x = (g.ancestors ?? [])
          .slice(0, 6)
          .map((S) => {
            let k = S.id ? `#${S.id}` : "",
              P =
                S.classNames && S.classNames.length > 0
                  ? `.${S.classNames.slice(0, 2).join(".")}`
                  : "";
            return `${S.tagName ?? "div"}${k}${P}`;
          })
          .join(" <- ");
      (p.push(`- **Target #${$}**: ${v}`),
        x && p.push(`  - **Ancestors**: ${x}`),
        g.sanitizedHtml &&
          p.push(`  - **sanitizedHtml**: \`${g.sanitizedHtml.slice(0, 600)}\``),
        g.computedStyle &&
          Object.keys(g.computedStyle).length > 0 &&
          p.push(`  - **computedStyle**: ${JSON.stringify(g.computedStyle)}`),
        g.state &&
          Object.keys(g.state).length > 0 &&
          p.push(`  - **state**: ${JSON.stringify(g.state)}`));
    }
    let m = a.sequenceContext;
    if (
      (p.push(`
## 3. Sequence Context (Raw Same-Time Context \u2014 NOT Proven Causality)`),
      !m)
    )
      p.push("(No sequenceContext recorded)");
    else {
      let $ = m.interactions ?? [],
        g = m.consoleErrors ?? [],
        v = m.networkFailures ?? [];
      p.push(
        `Window: ${m.windowMs ?? 6e4}ms before anchor | ${$.length} interactions, ${g.length} console errors, ${v.length} network failures`,
      );
      for (let x of $.slice(-15))
        p.push(
          `  - [${x.offsetMs ?? 0}ms] [${x.kind}] <${x.tagName ?? "?"}> text="${x.text ?? ""}" ${x.value !== void 0 ? `val="${x.value}"` : ""}`,
        );
      for (let x of g)
        p.push(
          `  - [${x.offsetMs ?? 0}ms] [CONSOLE ${x.level ?? "ERROR"}] ${x.text ?? ""}`,
        );
      for (let x of v)
        p.push(
          `  - [${x.offsetMs ?? 0}ms] [NET ${x.method ?? "GET"} ${x.status ?? "ERR"}] ${x.url ?? ""}`,
        );
    }
    i = w(
      p.join(`
`),
      e.maxChars,
    );
  }
  let f = [{ type: "text", text: i }],
    h = e.includeImage ?? !0,
    y = r.annotatedSource ?? r.originalSource;
  return (h && y && f.push(...H(t, y, `Scene [${r.index}] screenshot`)), f);
}
function Gt(e) {
  let t = E(e.pack);
  if (t.kind === "screenshot") {
    let c = t.getScreenshotImagePath();
    if (!c)
      throw new Error(
        `SCREENSHOT_NOT_FOUND: No screenshot image found in screenshot pack "${e.pack}".`,
      );
    return H(t, c, "Screenshot pack image");
  }
  let s = e.kind ?? (e.step !== void 0 ? "step" : "issue-annotated");
  if (s === "step") {
    let c = e.step ?? 1;
    for (let o of ["jpg", "png", "jpeg", "webp"]) {
      let l = `screenshots/step-${c}.${o}`;
      if (t.files.has(l)) {
        let i = t.data.screenshotSummaries?.find((h) => h.step === c),
          f = i
            ? `Step ${c} screenshot (+${i.elapsedMs ?? 0}ms [${i.kind ?? "?"}] ${i.element ?? ""})`
            : `Step ${c} screenshot`;
        return H(t, l, f);
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
  let a =
    s === "issue-original"
      ? (r.originalSource ?? r.annotatedSource)
      : (r.annotatedSource ?? r.originalSource);
  if (!a)
    throw new Error(
      `SCENE_IMAGE_MISSING: Scene "${r.id}" does not have a ${s} image file.`,
    );
  return H(t, a, `Scene [${r.index}] (${r.id}) ${s}`);
}
import { existsSync as rt } from "node:fs";
import { join as Kt, resolve as je } from "node:path";
function ds(e, t) {
  return typeof e == "string" && e.trim()
    ? e
    : Array.isArray(e) && e.length > 0
      ? e.map((s) => {
          let n = s.functionName || "<anonymous>",
            r = s.sourceMappedLocation,
            a =
              r?.resolved && r.originalFile
                ? `${r.originalFile}:${r.originalLine ?? 0}`
                : `${s.url ?? "?"}:${s.lineNumber ?? 0}`;
          return `at ${n} (${a})`;
        }).join(`
`)
      : t;
}
function Te(e, t = {}) {
  let s = e.getConsoleEntries(),
    n =
      t.levels && t.levels.length > 0
        ? new Set(
            t.levels.flatMap((l) => {
              let i = l.toLowerCase();
              return i === "warn" || i === "warning"
                ? ["warn", "warning"]
                : [i];
            }),
          )
        : void 0,
    r = t.search?.toLowerCase(),
    a = t.regex ? new RegExp(t.regex, "i") : void 0,
    c = [];
  s.forEach((l, i) => {
    let f = (l.level ?? "log").toLowerCase();
    if (n && !n.has(f)) return;
    let h = e.toRelativeMs(l.createdAt);
    if (
      (t.fromMs !== void 0 && h !== void 0 && h < t.fromMs) ||
      (t.toMs !== void 0 && h !== void 0 && h > t.toMs)
    )
      return;
    let y = l.text ?? "",
      p = l.url ?? l.source ?? "",
      d = ds(l.stackTrace, l.stack),
      m = `${y}
${p}
${d ?? ""}`;
    if ((r && !m.toLowerCase().includes(r)) || (a && !a.test(m))) return;
    let $ = p
        ? `${p}${l.lineNumber !== void 0 ? `:${l.lineNumber}` : ""}`
        : void 0,
      g = l.sourceMappedLocation,
      v = g?.originalFunctionName ?? g?.originalName,
      x =
        g?.resolved && g.originalFile
          ? `${g.originalFile}:${g.originalLine ?? 0}${g.originalColumn !== void 0 ? `:${g.originalColumn}` : ""}${v ? ` (${v})` : ""}`
          : void 0;
    c.push({
      index: i,
      id: l.id,
      relativeMs: h,
      level: f,
      text: y,
      location: $,
      sourceMapped: x,
      stack: d,
    });
  });
  let u = Math.max(0, t.offset ?? 0),
    o = Math.max(1, t.limit ?? 50);
  return {
    totalEntries: s.length,
    matchedCount: c.length,
    offset: u,
    limit: o,
    items: c.slice(u, u + o),
  };
}
function Re(e) {
  let t = b(e.relativeMs),
    s = e.sourceMapped
      ? ` (${e.location ?? "?"} -> ${e.sourceMapped})`
      : e.location
        ? ` (${e.location})`
        : "",
    n = `[#${e.index}] ${t} [${e.level.toUpperCase()}] ${e.text}${s}`;
  if (e.stack) {
    let r = e.stack
      .split(
        `
`,
      )
      .slice(0, 5)
      .map((a) => `    ${a.trim()}`).join(`
`);
    n += `
${r}`;
  }
  return n;
}
function ps(e, t, s) {
  let n = e.data.summary,
    r = e.getIssueScenes(),
    a = Te(e, { levels: ["error"], limit: 5 }),
    c = Ae(e, { status: "failed", limit: 5 }),
    u = e.listFiles(),
    o = O(e),
    l = o && rt(Kt(o, W)) ? je(o, W) : void 0,
    i = o
      ? Me.map((m) => je(o, ...m.target.split("/"))).filter((m) => rt(m))
      : [],
    f = o
      ? Array.from(e.skippedMediaFiles.keys()).map((m) =>
          je(o, ...m.split("/")),
        )
      : [];
  if (t === "json") {
    let m = {
      kind: "session",
      packPath: e.packPath,
      workspaceDir: o,
      indexPath: l,
      derivedJsonFiles: i,
      recordingPaths: f,
      sessionId: e.sessionId,
      integrity: e.integrity,
      summary: n,
      issueScenes: r.map(($) => {
        let g = $.scene.narrative?.expected,
          v = typeof g == "string" ? g : g?.text,
          x =
            typeof g == "object" && g !== null
              ? (g.confidence ?? "missing")
              : v
                ? "explicit"
                : "missing";
        return {
          id: $.id,
          index: $.index,
          actual: $.scene.narrative?.actual ?? null,
          expected: v ?? null,
          expectedConfidence: x,
          originalSource: $.originalSource,
          annotatedSource: $.annotatedSource,
        };
      }),
      topConsoleErrors: a.items,
      topNetworkFailures: c.items,
      filesCount: u.length,
      files: u,
    };
    return w(JSON.stringify(m, null, 2), s);
  }
  let h = [];
  if (
    (e.integrity.schemaWarning &&
      h.push(`\u26A0\uFE0F ${e.integrity.schemaWarning}
`),
    e.integrity.valid ||
      h.push(`\u26A0\uFE0F Integrity check reported mismatches: ${e.integrity.mismatches.join("; ")}
`),
    h.push("# Bug Lens Evidence Pack (kind: session)"),
    o && h.push(`- **Workspace**: \`${o}\``),
    l &&
      h.push(
        `- **Index**: \`${l}\` (read this file for full schema, request->body map, and jq recipes)`,
      ),
    i.length > 0 &&
      h.push(`- **Derived JSON**: ${i.map((m) => `\`${m}\``).join(", ")}`),
    f.length > 0 &&
      h.push(`- **Recording**: ${f.map((m) => `\`${m}\``).join(", ")}`),
    h.push(`- **Session ID**: \`${e.sessionId}\``),
    h.push(
      `- **Schema**: v${e.integrity.schemaVersion ?? e.data.session?.schemaVersion ?? "?"} (integrity: ${e.integrity.valid ? "OK" : "MISMATCH"}, checked ${e.integrity.checkedCount} files)`,
    ),
    h.push(
      `- **Page**: ${n?.title ?? e.data.session?.target?.initialTitle ?? "\u2014"} (${n?.url ?? e.data.session?.target?.initialUrl ?? "\u2014"})`,
    ),
    h.push(
      `- **Duration**: ${V(n?.durationMs ?? e.data.session?.timeline?.durationMs)} | Quality: ${n?.quality ?? "\u2014"} | Privacy: ${n?.privacyMode ?? "\u2014"}`,
    ),
    n?.environment)
  ) {
    let m = n.environment;
    h.push(
      `- **Environment**: ${m.os ?? "?"} \xB7 ${m.browser ?? "?"} \xB7 ${m.language ?? "?"} \xB7 screen ${m.screen ?? "?"} \xB7 viewport ${m.viewport ?? "?"}`,
    );
  }
  if (
    (h.push(
      `- **Counts**: ${e.getInteractions().length} interactions | ${e.getConsoleEntries().length} console entries (${a.matchedCount} errors) | ${e.getNetworkEntries().length} network requests (${c.matchedCount} failed) | ${r.length} issue scenes | ${e.getFrameworkStates().length} framework snapshots`,
    ),
    h.push(`
## Issue Scenes (${r.length})`),
    r.length === 0)
  )
    h.push("(No issue scenes marked in this session)");
  else
    for (let m of r) {
      let $ = e.toRelativeMs(
          m.scene.selectionStartedAtEpochMs ?? m.scene.observedAtEpochMs,
        ),
        g = m.scene.narrative?.expected,
        v = typeof g == "string" ? g : g?.text,
        x =
          typeof g == "object" && g !== null
            ? (g.confidence ?? "missing")
            : v
              ? "explicit"
              : "missing";
      (h.push(`- **Scene [${m.index}] \`${m.id}\`** (at ${b($)}):`),
        h.push(`  - **actual**: ${m.scene.narrative?.actual || "(empty)"}`),
        h.push(
          `  - **expected** [confidence=${x}]: ${v || "(not captured \u2014 treat any expectation as inferred hypothesis)"}`,
        ),
        h.push(
          `  - **screenshots**: annotated=\`${m.annotatedSource ?? "none"}\`, original=\`${m.originalSource ?? "none"}\``,
        ));
      let S = m.annotatedSource ?? m.originalSource;
      if (S) {
        let k = Pe(e, S);
        k &&
          h.push(
            `  - **savedImagePath**: \`${k}\` (call \`read_file\` on this path to view the scene screenshot)`,
          );
      }
    }
  if (
    (h.push(`
## Top Console Errors (${a.matchedCount} total)`),
    a.items.length === 0)
  )
    h.push("(No console errors recorded)");
  else for (let m of a.items) h.push(`- ${Re(m)}`);
  if (
    (h.push(`
## Top Failed Network Requests (${c.matchedCount} total)`),
    c.items.length === 0)
  )
    h.push("(No failed network requests recorded)");
  else for (let m of c.items) h.push(`- ${Ie(m)}`);
  h.push(`
## Package Files (${u.length})`);
  let y = u.filter(
      (m) =>
        !m.path.startsWith("screenshots/") &&
        !m.path.startsWith("network/body-"),
    ),
    p = u.filter((m) => m.path.startsWith("network/body-")).length,
    d = u.filter((m) => m.path.startsWith("screenshots/")).length;
  for (let m of y)
    h.push(
      `- \`${m.path}\` (${m.byteLength} B${m.skippedMedia ? ", extracted on disk" : ""})`,
    );
  return (
    p > 0 && h.push(`- \`network/body-*.txt\` (${p} split body files)`),
    d > 0 && h.push(`- \`screenshots/step-*.*\` (${d} step screenshots)`),
    h.push(
      '\n**Next steps** (active pack is extracted & cached; omit `--pack` in subsequent commands): Run `get_scene` to inspect DOM targets & annotated screenshot, `timeline --windowMs 15000` for chronological events around the issue, `query_network --status failed` / `get_request <id> --jsonPath "..."` for API bodies, `get_framework_state` for Vue/React state, or read `INDEX.md` and query `data/session-data.json` / `network/body-*.txt` directly with `jq`.',
    ),
    w(
      h.join(`
`),
      s,
    )
  );
}
function ms(e, t, s) {
  let n = e.domContext,
    r = n?.anchors ?? [],
    a = e.listFiles(),
    c = O(e),
    u = c && rt(Kt(c, W)) ? je(c, W) : void 0;
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
          anchors: r.map((d) => ({
            selector: d.selector,
            selectorPath: d.selectorPath,
            tagName: d.tagName,
            componentName: d.componentName,
            componentFile: d.componentFile,
            intentFlags: d.intentFlags,
            innerText: d.innerText?.slice(0, 120),
          })),
          hasCascade: !!e.cascade,
          files: a,
        },
        null,
        2,
      ),
      s,
    );
  let o = [],
    l = e.environment,
    i = l?.recentConsoleErrors ?? [],
    f = l?.recentFailedRequests ?? [],
    h = l?.frameworkComponentStates ?? l?.vueComponentStates ?? [],
    y = e.getScreenshotImagePath(),
    p = y ? Pe(e, y) : void 0;
  if (
    (o.push("# Bug Lens Screenshot Pack (kind: screenshot)"),
    c && o.push(`- **Workspace**: \`${c}\``),
    u && o.push(`- **Index**: \`${u}\``),
    o.push(
      `- **Image**: \`${y ?? "none"}\`${p ? ` -> Saved to \`${p}\` (call \`read_file\` on this path to inspect visually)` : ""}`,
    ),
    l &&
      (o.push(`- **Page**: ${l.title ?? "\u2014"} (${l.url ?? "\u2014"})`),
      o.push(
        `- **Viewport**: ${l.viewport?.width ?? "?"}x${l.viewport?.height ?? "?"} (${l.mediaBreakpoint ?? "?"}) | UA: ${l.userAgent ?? "\u2014"}`,
      ),
      o.push(
        `- **Anomalies & State**: ${i.length} recent console error(s) | ${f.length} failed request(s) | ${h.length} component state snapshot(s)`,
      )),
    n)
  ) {
    o.push(
      `- **DOM Context**: SCA=\`${n.smallestCommonAncestorSelector ?? "?"}\` | anchors=${n.meta?.anchorCount ?? r.length}, leaves=${n.meta?.leafCount ?? n.leaves?.length ?? 0}, ancestors=${n.meta?.ancestorCount ?? n.ancestors?.length ?? 0}`,
    );
    let d = Ne(n);
    if (d.length > 0) {
      o.push(`
## Layout & Overflow Diagnostics (${d.length} distinct issue group(s))`);
      for (let g of d) {
        let v =
            g.anchorIndices.length > 0
              ? ` (anchors: [${g.anchorIndices.slice(0, 6).join(", ")}${g.anchorIndices.length > 6 ? `, ... (${g.anchorIndices.length} total)` : ""}])`
              : "",
          x = g.component ? ` [${g.component}]` : "";
        (o.push(
          `- \u26A0\uFE0F **[${g.kind}] \`${g.selectorPath ?? g.selector}\`**${x}${v}: ${g.summary}`,
        ),
          g.sampleText && o.push(`  - sampleText: "${g.sampleText}"`),
          g.keyStyles &&
            o.push(`  - keyComputedStyles: ${JSON.stringify(g.keyStyles)}`));
      }
    }
    o.push(`
## Annotated DOM Anchors (${r.length})`);
    let m = new Map(),
      $ = [];
    r.forEach((g, v) => {
      let x = `${g.selectorPath ?? g.selector ?? "?"}|${g.componentName ?? ""}|${JSON.stringify(g.intentFlags ?? {})}`,
        S = m.get(x);
      S ? S.push(v) : (m.set(x, [v]), $.push({ idx: v, anchor: g, sig: x }));
    });
    for (let { idx: g, anchor: v, sig: x } of $.slice(0, 15)) {
      let S = m.get(x) ?? [g],
        k =
          S.length > 1
            ? ` (+${S.length - 1} siblings: [${S.slice(1, 5).join(",")}${S.length > 5 ? ",..." : ""}])`
            : "",
        P = [];
      (v.intentFlags?.isArrowTarget && P.push("arrow"),
        v.intentFlags?.isHighlightedFocus && P.push("focus"),
        v.intentFlags?.textComment &&
          P.push(`comment="${v.intentFlags.textComment}"`));
      let I = P.length > 0 ? ` [${P.join(",")}]` : "",
        D = v.componentName
          ? ` [${v.componentName}${v.componentFile ? ` @ ${v.componentFile}${v.componentLine ? `:${v.componentLine}` : ""}` : ""}]`
          : "",
        Q = v.selectorPath ?? v.selector ?? "?",
        T = Q.length > 75 ? `\u2026${Q.slice(-72)}` : Q,
        ce = (v.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 50);
      o.push(`- [${g}] \`${T}\`${D}${I}${k}${ce ? ` text="${ce}"` : ""}`);
    }
    $.length > 15 &&
      o.push(
        `- ... +${$.length - 15} more unique anchors (use \`get_scene(selector="...")\` to filter)`,
      );
  }
  if ((e.cascade && o.push(...Jt(e.cascade)), i.length > 0)) {
    o.push(`
## Recent Console Errors (${i.length})`);
    for (let [d, m] of i.slice(0, 5).entries())
      o.push(`- [#${d}] ${m.message ?? ""}`);
  }
  if (f.length > 0) {
    o.push(`
## Recent Failed Network Requests (${f.length})`);
    for (let d of f.slice(0, 5))
      o.push(`- ${d.method ?? "GET"} ${d.status ?? 0} ${d.url ?? ""}`);
  }
  o.push(`
## Files (${a.length})`);
  for (let d of a) o.push(`- \`${d.path}\` (${d.byteLength} B)`);
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
function Xt(e) {
  let t = E(e.pack),
    s = e.format ?? "text";
  return t.kind === "session" ? ps(t, s, e.maxChars) : ms(t, s, e.maxChars);
}
function Zt(e) {
  let t = E(e.pack);
  if (t.kind === "screenshot") {
    let a = t.environment?.recentConsoleErrors ?? [],
      c = e.search?.toLowerCase(),
      u = e.regex ? new RegExp(e.regex, "i") : void 0,
      o = a.filter((i) => {
        let f = `${i.message ?? ""}
${i.stack ?? ""}`;
        return !((c && !f.toLowerCase().includes(c)) || (u && !u.test(f)));
      });
    if (e.format === "json")
      return w(
        JSON.stringify(
          { totalEntries: a.length, matchedCount: o.length, items: o },
          null,
          2,
        ),
        e.maxChars,
      );
    let l = [
      `# Screenshot Pack Console Errors (${o.length} of ${a.length})`,
      ...o.map(
        (i, f) =>
          `[#${f}] [ERROR] ${i.message ?? ""}${
            i.stack
              ? `
    ${i.stack
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
      l.join(`
`),
      e.maxChars,
    );
  }
  let s = Te(t, {
    levels: e.levels,
    search: e.search,
    regex: e.regex,
    fromMs: e.fromMs,
    toMs: e.toMs,
    offset: e.offset,
    limit: e.limit,
  });
  if (e.format === "json") return w(JSON.stringify(s, null, 2), e.maxChars);
  let n = [];
  if (
    (n.push(
      `# Console Logs (matched ${s.matchedCount} of ${s.totalEntries} total, showing offset=${s.offset}..${s.offset + s.items.length})`,
    ),
    s.items.length === 0)
  )
    n.push("(No console entries matched the given filters)");
  else for (let a of s.items) n.push(Re(a));
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
function Vt(e) {
  let t = E(e.pack);
  if (t.kind === "screenshot") {
    let a = t.environment?.recentFailedRequests ?? [],
      c = e.urlContains?.toLowerCase(),
      u = e.method?.toUpperCase(),
      o = a.filter(
        (i) =>
          !(
            (c && !(i.url ?? "").toLowerCase().includes(c)) ||
            (u && (i.method ?? "GET").toUpperCase() !== u)
          ),
      );
    if (e.format === "json")
      return w(
        JSON.stringify(
          { totalEntries: a.length, matchedCount: o.length, items: o },
          null,
          2,
        ),
        e.maxChars,
      );
    let l = [
      `# Screenshot Pack Failed Network Requests (${o.length} of ${a.length})`,
      ...o.map(
        (i, f) =>
          `- [#${f}] ${i.method ?? "GET"} !${i.status ?? 0} ${i.statusText ?? ""} | ${i.url ?? ""}`,
      ),
    ];
    return w(
      l.join(`
`),
      e.maxChars,
    );
  }
  let s = Ae(t, {
    status: e.status,
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
  else for (let a of s.items) n.push(`- ${Ie(a)}`);
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
import { existsSync as gs, readFileSync as ys } from "node:fs";
import { resolve as Yt, sep as vs } from "node:path";
function xs(e, t) {
  if (!e) return;
  let s = Yt(e),
    n = Yt(s, ...t.split("/"));
  if (!(!n.startsWith(s + vs) || !gs(n))) return ys(n, "utf8");
}
function en(e) {
  let t = E(e.pack),
    s = e.path.replace(/^\.?\//, ""),
    n = t.getTextFile(s) ?? xs(O(t), s);
  if (n === void 0) {
    let o = t
      .listFiles()
      .map((l) => l.path)
      .slice(0, 30)
      .join(", ");
    throw new Error(
      `FILE_NOT_FOUND_IN_PACK: "${s}" does not exist in pack. Available files sample: [${o}]`,
    );
  }
  if (e.jsonPath) {
    let o;
    if (s.endsWith(".js")) o = Y(n, s);
    else
      try {
        o = JSON.parse(n);
      } catch (i) {
        let f = i instanceof Error ? i.message : String(i);
        throw new Error(
          `INVALID_JSON_FILE: Cannot apply jsonPath "${e.jsonPath}" to "${s}": ${f}`,
        );
      }
    let l = te(o, e.jsonPath);
    return w(JSON.stringify(l, null, 2), e.maxChars ?? 24e3);
  }
  let r = Math.max(0, e.offset ?? 0),
    a = e.maxChars ?? 24e3,
    c = n.slice(r),
    u = r + a;
  return w(
    c,
    a,
    n.length > u
      ? `Use offset=${u} to read the next chunk (total ${n.length} chars).`
      : void 0,
  );
}
function ot(e, t, s = 180, n = 3) {
  let r = t.includes("svg")
      ? e
      : e.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "<svg/>"),
    a = r.toLowerCase(),
    c = [],
    u = 0;
  for (; u < a.length && c.length < n;) {
    let o = a.indexOf(t, u);
    if (o < 0) break;
    let l = Math.max(0, o - s),
      i = Math.min(r.length, o + t.length + s),
      f = c[c.length - 1];
    (f && l <= f.end
      ? (f.end = Math.max(f.end, i))
      : c.push({ start: l, end: i }),
      (u = o + Math.max(1, t.length)));
  }
  return c.length === 0
    ? [
        r
          .slice(0, s * 2)
          .replace(/\s+/g, " ")
          .trim(),
      ]
    : c.map(({ start: o, end: l }) => {
        let i = o > 0 ? "\u2026" : "",
          f = l < r.length ? "\u2026" : "";
        return i + r.slice(o, l).replace(/\s+/g, " ").trim() + f;
      });
}
function tn(e, t) {
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
    a = Math.max(1, t.limit ?? 30),
    c = Math.min(2e3, Math.max(40, t.contextChars ?? 180)),
    u = [];
  if (
    (r.has("console") &&
      e.getConsoleEntries().forEach((o, l) => {
        let i = `${o.text ?? ""} ${o.url ?? ""} ${o.stackTrace ?? o.stack ?? ""}`;
        if (i.toLowerCase().includes(n)) {
          let f = e.toRelativeMs(o.createdAt),
            [h] = ot(i, n, c, 1);
          u.push({
            scope: "console",
            ref: `console#${l}`,
            relativeMs: f,
            snippet: `${b(f)} [${o.level ?? "log"}] ${h}`,
          });
        }
      }),
    r.has("network-url"))
  ) {
    for (let o of e.getNetworkEntries())
      if (o.url.toLowerCase().includes(n)) {
        let l = e.toRelativeMs(o.createdAt);
        u.push({
          scope: "network-url",
          ref: o.id,
          relativeMs: l,
          snippet: `${b(l)} ${o.method ?? "GET"} ${o.status ?? 0} ${o.url}`,
        });
      }
  }
  if (r.has("network-body"))
    for (let o of e.getNetworkEntries()) {
      let l = e.getNetworkBody(o);
      if (l && l.toLowerCase().includes(n)) {
        let i = e.toRelativeMs(o.createdAt),
          f = ot(l, n, c, 3);
        for (let h of f)
          u.push({
            scope: "network-body",
            ref: o.id,
            relativeMs: i,
            snippet: `${b(i)} (${o.url}) ${h}`,
          });
      }
    }
  return (
    r.has("interactions") &&
      e.getInteractions().forEach((o, l) => {
        let i = ae(o, l, e.toRelativeMs(o.createdAt)),
          f = JSON.stringify(o.element ?? o.target ?? {});
        (i.toLowerCase().includes(n) || f.toLowerCase().includes(n)) &&
          u.push({
            scope: "interactions",
            ref: `interaction#${l}`,
            relativeMs: e.toRelativeMs(o.createdAt),
            snippet: i,
          });
      }),
    r.has("framework") &&
      e.getFrameworkStates().forEach((o, l) => {
        let i = JSON.stringify(o);
        if (i.toLowerCase().includes(n)) {
          let f = e.toRelativeMs(o.capturedAtEpochMs),
            h = ot(i, n, c, 2);
          for (let y of h)
            u.push({
              scope: "framework",
              ref: `frameworkState#${l}`,
              relativeMs: f,
              snippet: `${b(f)} [trigger=${o.trigger ?? "?"}] ${y}`,
            });
        }
      }),
    { query: s, totalHits: u.length, hits: u.slice(0, a) }
  );
}
function $s(e, t, s = 30, n = 180) {
  let r = t.trim().toLowerCase();
  if (!r) return { totalHits: 0, hits: [] };
  let a = [];
  if (
    ((e.domContext?.anchors ?? []).forEach((o, l) => {
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
        let f = o.componentName
            ? ` [${o.componentName}${o.componentFile ? ` @ ${o.componentFile}:${o.componentLine ?? ""}` : ""}]`
            : "",
          h = o.layoutContext?.textOverflow?.reason;
        a.push({
          category: "dom-anchor",
          ref: `anchor#${l}`,
          detail: `\`${o.selectorPath ?? o.selector ?? "?"}\`${f} text="${(o.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 80)}"${h ? ` | overflow: ${h}` : ""} | styles=${JSON.stringify(o.computedStyles ?? {})}`,
        });
      }
    }),
    e.cascade)
  ) {
    let o = e.cascade.sheets ?? [],
      l = e.cascade.rules ?? [],
      i = e.cascade.elements ?? [],
      f = new Map();
    for (let d of o) f.set(d.id, d);
    let h = new Map();
    for (let d of l) h.set(d.id, d);
    let y = new Map();
    for (let d of i) {
      let m = `${d.id}(${d.selector})`;
      for (let $ of d.matchedRuleIds ?? []) {
        let g = y.get($);
        g ? g.push(m) : y.set($, [m]);
      }
    }
    for (let d of o)
      (d.id.toLowerCase() === r ||
        (d.href && d.href.toLowerCase().includes(r))) &&
        a.push({
          category: "cascade-sheet",
          ref: d.id,
          detail: `href=${d.href ?? "inline"} (${d.rulesCount ?? 0} rules, tag=<${d.ownerNodeTag ?? "style"}>)`,
        });
    for (let [d, m] of i.entries())
      if (m.id.toLowerCase() === r || m.selector.toLowerCase().includes(r)) {
        let $ = (m.matchedRuleIds ?? [])
          .slice(-6)
          .map((g) => {
            let v = h.get(g);
            return v ? `${g}:${v.selectorText}` : g;
          })
          .join(", ");
        a.push({
          category: "cascade-element",
          ref: `${m.id} (index ${d})`,
          detail: `<${m.tagName}> \`${m.selector}\` (${(m.matchedRuleIds ?? []).length} matched rules, e.g. [${$}])`,
        });
      }
    let p = new Map();
    for (let d of l)
      if (
        d.id.toLowerCase() === r ||
        d.selectorText.toLowerCase().includes(r) ||
        d.cssText.toLowerCase().includes(r)
      ) {
        let m = `${d.selectorText}||${d.cssText}`,
          $ = f.get(d.sheetId),
          g = $?.href ? `${d.sheetId} (${$.href})` : `${d.sheetId} (inline)`,
          v = y.get(d.id) ?? [],
          x = p.get(m);
        if (x) {
          (x.ruleIds.push(d.id), x.sheetRefs.add(g));
          for (let S of v) x.matchedElements.add(S);
        } else
          p.set(m, {
            rule: d,
            ruleIds: [d.id],
            sheetRefs: new Set([g]),
            matchedElements: new Set(v),
          });
      }
    for (let d of p.values()) {
      let m =
          d.ruleIds.length > 3
            ? `${d.ruleIds.slice(0, 3).join(", ")} (+${d.ruleIds.length - 3})`
            : d.ruleIds.join(", "),
        $ = Array.from(d.sheetRefs).slice(0, 2).join(" | "),
        g = Array.from(d.matchedElements),
        v =
          g.length > 0
            ? ` | matchedElements: [${g.slice(0, 5).join(", ")}${g.length > 5 ? ", ..." : ""}]`
            : "";
      a.push({
        category: "cascade-rule",
        ref: m,
        detail: `[sheet: ${$}] \`${d.rule.selectorText}\` -> \`${d.rule.cssText}\`${v}`,
      });
    }
  }
  if (
    ((
      e.environment?.frameworkComponentStates ??
      e.environment?.vueComponentStates ??
      []
    ).forEach((o, l) => {
      JSON.stringify(o).toLowerCase().includes(r) &&
        a.push({
          category: "component-state",
          ref: `${o.componentName ?? "Component"}#${l}`,
          detail: `${o.componentFile ? `@ ${o.componentFile}:${o.componentLine ?? ""} ` : ""}props=${JSON.stringify(o.props ?? {})} data=${JSON.stringify(o.data ?? o.state ?? {})}`,
        });
    }),
    a.length === 0)
  ) {
    for (let o of e.listFiles())
      if (o.path.endsWith(".json") || o.path.endsWith(".md")) {
        let l = e.getTextFile(o.path) ?? "",
          i = l.toLowerCase().indexOf(r);
        if (i >= 0) {
          let f = Math.max(0, i - n),
            h = Math.min(l.length, i + r.length + n);
          a.push({
            category: "file",
            ref: o.path,
            detail: l.slice(f, h).replace(/\s+/g, " ").trim(),
          });
        }
      }
  }
  return { totalHits: a.length, hits: a.slice(0, s) };
}
function nn(e) {
  let t = E(e.pack),
    s = Math.min(2e3, Math.max(40, e.contextChars ?? 180));
  if (t.kind === "screenshot") {
    let a = $s(t, e.query, e.limit ?? 30, s);
    if (e.format === "json")
      return w(
        JSON.stringify(
          { query: e.query, totalHits: a.totalHits, hits: a.hits },
          null,
          2,
        ),
        e.maxChars,
      );
    let c = [
      `# Search Results in Screenshot Pack for "${e.query}" (showing ${a.hits.length} of ${a.totalHits} total hits)`,
      ...(a.hits.length === 0
        ? [
            "(No matches found in dom-context.json, cascade.json, or environment.json)",
          ]
        : a.hits.map(
            (u) => `- **[${u.category}]** \`${u.ref}\` \u2014 ${u.detail}`,
          )),
    ];
    return w(
      c.join(`
`),
      e.maxChars,
    );
  }
  let n = tn(t, {
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
    for (let a of n.hits)
      r.push(`- **[${a.scope}]** \`${a.ref}\` \u2014 ${a.snippet}`);
  return w(
    r.join(`
`),
    e.maxChars,
  );
}
function sn(e, t = {}) {
  let s = new Set(
      t.kinds && t.kinds.length > 0
        ? t.kinds
        : ["interaction", "console", "network", "scene"],
    ),
    n = t.fromMs,
    r = t.toMs,
    a = "Full session timeline";
  if (
    t.aroundSceneId !== void 0 ||
    (n === void 0 && r === void 0 && t.windowMs !== void 0)
  ) {
    let l = e.getIssueScenes(),
      i = t.aroundSceneId
        ? (l.find(
            (f) =>
              f.id === t.aroundSceneId || String(f.index) === t.aroundSceneId,
          ) ?? l[0])
        : l[0];
    if (i) {
      let f =
          i.scene.selectionStartedAtEpochMs ??
          i.scene.observedAtEpochMs ??
          i.scene.sequenceContext?.anchorEpochMs,
        h = e.toRelativeMs(f);
      if (h !== void 0) {
        let y = t.windowMs ?? 15e3;
        ((n = h - y),
          (r = h + Math.min(5e3, Math.floor(y / 3))),
          (a = `Around scene "${i.id}" (${b(n)} .. ${b(r)})`));
      }
    }
  } else
    (n !== void 0 || r !== void 0) &&
      (a = `Range ${b(n ?? 0)} .. ${b(r ?? 1 / 0)}`);
  let c = [];
  if (
    (s.has("interaction") &&
      e.getInteractions().forEach((i, f) => {
        let h = e.toRelativeMs(i.createdAt) ?? i.elapsedMs ?? 0,
          y = i.createdAt ?? e.toEpochMs(h);
        c.push({
          kind: "interaction",
          epochMs: y,
          relativeMs: h,
          refId: f,
          summary: ae(i, f, h),
        });
      }),
    s.has("console") &&
      e.getConsoleEntries().forEach((i, f) => {
        let h = (i.level ?? "log").toLowerCase();
        if (
          !t.includeAllConsole &&
          h !== "error" &&
          h !== "warning" &&
          h !== "warn"
        )
          return;
        let y = e.toRelativeMs(i.createdAt) ?? 0,
          p = i.createdAt ?? e.toEpochMs(y),
          d = (i.text ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
        c.push({
          kind: "console",
          epochMs: p,
          relativeMs: y,
          refId: i.id ?? f,
          summary: `${b(y)} [console.${h}] ${d}`,
        });
      }),
    s.has("network") &&
      e.getNetworkEntries().forEach((i) => {
        let f = i.status ?? 0,
          h = f === 0 || f >= 400 || !!i.errorText,
          y = (i.type ?? "").toLowerCase(),
          p = y === "xhr" || y === "fetch" || y === "document";
        if (!t.includeAllNetwork && !h && !p) return;
        let d = e.toRelativeMs(i.createdAt) ?? 0,
          m = i.createdAt ?? e.toEpochMs(d),
          $ = i.method ?? "GET",
          g = V(i.durationMs),
          v = h ? `!${f || "ERR"}` : String(f);
        c.push({
          kind: "network",
          epochMs: m,
          relativeMs: d,
          refId: i.id,
          summary: `${b(d)} [net ${$} ${v} ${g}] ${i.url} (id=${i.id})`,
        });
      }),
    s.has("scene"))
  )
    for (let l of e.getIssueScenes()) {
      let i = l.scene.selectionStartedAtEpochMs ?? l.scene.observedAtEpochMs,
        f = e.toRelativeMs(i) ?? 0,
        h = l.scene.narrative?.actual ?? "(no narrative)";
      c.push({
        kind: "scene",
        epochMs: i ?? e.toEpochMs(f),
        relativeMs: f,
        refId: l.id,
        summary: `${b(f)} [ISSUE SCENE ${l.id}] actual="${h}"`,
      });
    }
  let u = c
      .filter(
        (l) =>
          !(
            (n !== void 0 && l.relativeMs < n) ||
            (r !== void 0 && l.relativeMs > r)
          ),
      )
      .sort((l, i) => l.relativeMs - i.relativeMs),
    o = t.limit ?? 80;
  return {
    windowDescription: a,
    totalMatched: u.length,
    events: u.slice(0, o),
  };
}
function rn(e) {
  let t = E(e.pack);
  if (t.kind !== "session")
    throw new Error(
      `UNSUPPORTED_PACK_KIND: timeline requires a session evidence pack, but "${e.pack}" is a screenshot pack.`,
    );
  let s = sn(t, {
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
function ks(e) {
  let t = {},
    s = [];
  for (let r = 0; r < e.length; r++) {
    let a = e[r];
    if (a === "--") {
      s.push(...e.slice(r + 1));
      break;
    }
    if (a.startsWith("--")) {
      let u = a.indexOf("=");
      if (u > 2) {
        let o = a.slice(2, u),
          l = a.slice(u + 1);
        t[o] = l;
      } else {
        let o = a.slice(2),
          l = e[r + 1];
        l !== void 0 && !l.startsWith("--") ? ((t[o] = l), r++) : (t[o] = !0);
      }
      continue;
    }
    let c = /^([a-zA-Z][a-zA-Z0-9_]*)=(.+)$/.exec(a);
    if (c && !Fe(a)) {
      t[c[1]] = c[2];
      continue;
    }
    s.push(a);
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
      for (let [a, c] of Object.entries(r))
        typeof c == "boolean" || typeof c == "string"
          ? (t[a] = c)
          : typeof c == "number"
            ? (t[a] = String(c))
            : Array.isArray(c) && (t[a] = c.join(","));
    } catch {}
  return { flags: t, positionals: s };
}
function M(e, ...t) {
  for (let s of t) {
    let n = e[s];
    if (typeof n == "string" && n.trim().length > 0) return n.trim();
  }
}
function A(e, ...t) {
  let s = M(e, ...t);
  if (s === void 0) return;
  let n = Number(s);
  return Number.isFinite(n) ? n : void 0;
}
function _e(e, ...t) {
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
function ge(e, ...t) {
  let s = M(e, ...t);
  if (!s) return;
  let n = s
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  return n.length > 0 ? n : void 0;
}
function Cs(e) {
  return e ? (/\.zip$/i.test(e) ? !0 : Fe(e)) : !1;
}
function L(e, t, s = !1) {
  let n = M(e, "pack", "p");
  return n
    ? { pack: n, rest: t }
    : t.length > 0 && (s || Cs(t[0]))
      ? { pack: t[0], rest: t.slice(1) }
      : { pack: void 0, rest: t };
}
function it(e) {
  return e.filter((t) => t.type === "text").map((t) => t.text).join(`

`);
}
function bs() {
  return `Bug Lens Evidence Triage CLI
Usage: node bug-lens-cli.mjs <command> [options]

Commands:
  open_pack <zipOrDir>                        Extract pack to workspace (idempotent), generate derived JSON & INDEX.md, cache session path, and print overview
  get_scene [--selector S] [--cssProperty P]  Inspect issue scene (session) or DOM anchor & CSS cascade rules (screenshot)
  get_screenshot [--kind K] [--step N]        Locate screenshot image in workspace and print path
  timeline [--aroundSceneId ID] [--windowMs]  Unified chronological timeline of interactions, console errors, and network requests
  query_console [--levels error,warning]      Filter console logs and source-mapped stack traces
  query_network [--status failed|4xx|5xx]     Filter network requests (prioritizes failures)
  get_request <id> [--jsonPath EXPR]          Inspect request headers, initiator stack, and response body (with JSONPath)
  get_interactions [--fromIndex N] [--limit]  List recorded user interactions
  get_framework_state [--component NAME]      Inspect Vue/React component props, state, and webStorage snapshots
  search_pack <query>                         Cross-search console, network URLs/bodies, interactions, cascade rules, and state
  read_pack_file <path> [--jsonPath EXPR]     Read raw JSON/JS/text file or workspace artifact (INDEX.md, data/*.json)
  extract_pack [--dest DIR]                   Describe active workspace or copy extracted pack to custom directory`;
}
function Es(e) {
  let t = e[0]?.trim();
  if (
    !t ||
    t === "-h" ||
    t === "--help" ||
    t === "help" ||
    e.slice(1).some((u) => u === "-h" || u === "--help")
  )
    return bs();
  let s = t.replace(/-/g, "_").toLowerCase(),
    { flags: n, positionals: r } = ks(e.slice(1)),
    a = M(n, "format") === "json" ? "json" : "text",
    c = A(n, "maxChars", "max_chars");
  switch (s) {
    case "open_pack": {
      let { pack: u } = L(n, r, !0);
      if (!u)
        throw new Error(
          "Usage: bug-lens-cli.mjs open_pack <zipPath> [--format text|json]",
        );
      return Xt({ pack: u, format: a, maxChars: c });
    }
    case "get_scene": {
      let { pack: u, rest: o } = L(n, r),
        l = A(n, "sceneIndex", "scene_index", "index"),
        i = M(n, "sceneId", "scene_id"),
        f = M(n, "selector", "s") ?? o[0],
        h = M(n, "cssProperty", "css_property", "prop"),
        y = _e(
          n,
          "includeImage",
          "include_image",
          "includeScreenshot",
          "include_screenshot",
        ),
        p = Ht({
          pack: u,
          sceneId:
            i ?? (l === void 0 && o[0] && /^\d+$/.test(o[0]) ? o[0] : void 0),
          sceneIndex: l,
          selector: f,
          cssProperty: h,
          includeImage: y,
          format: a,
          maxChars: c,
        });
      return it(p);
    }
    case "get_screenshot": {
      let { pack: u, rest: o } = L(n, r),
        l = M(n, "kind") ?? o[0],
        i = A(n, "step"),
        f = M(n, "sceneId", "scene_id"),
        h = Gt({ pack: u, kind: l, step: i, sceneId: f });
      return it(h);
    }
    case "timeline": {
      let { pack: u, rest: o } = L(n, r),
        l = M(n, "aroundSceneId", "around_scene_id", "around") ?? o[0],
        i = l?.startsWith("scene:")
          ? String(Math.max(0, Number(l.slice(6)) - 1))
          : l;
      return rn({
        pack: u,
        aroundSceneId: i,
        fromMs: A(n, "fromMs", "from_ms"),
        toMs: A(n, "toMs", "to_ms"),
        windowMs: A(n, "windowMs", "window_ms"),
        kinds: ge(n, "kinds", "kind"),
        includeAllConsole: _e(n, "includeAllConsole", "include_all_console"),
        includeAllNetwork: _e(n, "includeAllNetwork", "include_all_network"),
        limit: A(n, "limit"),
        format: a,
        maxChars: c,
      });
    }
    case "query_console": {
      let { pack: u, rest: o } = L(n, r);
      return Zt({
        pack: u,
        levels: ge(n, "levels", "level"),
        search: M(n, "search", "query", "q") ?? o[0],
        regex: M(n, "regex"),
        fromMs: A(n, "fromMs", "from_ms"),
        toMs: A(n, "toMs", "to_ms"),
        offset: A(n, "offset"),
        limit: A(n, "limit"),
        format: a,
        maxChars: c,
      });
    }
    case "query_network": {
      let { pack: u, rest: o } = L(n, r),
        l = M(n, "status"),
        i = l && /^\d+(,\d+)*$/.test(l) ? l.split(",").map(Number) : l;
      return Vt({
        pack: u,
        status: i,
        urlContains: M(n, "urlContains", "url_contains", "url") ?? o[0],
        method: M(n, "method"),
        type: M(n, "type"),
        offset: A(n, "offset"),
        limit: A(n, "limit"),
        format: a,
        maxChars: c,
      });
    }
    case "get_request": {
      let { pack: u, rest: o } = L(n, r),
        l = M(n, "id", "requestId", "request_id") ?? o[0];
      if (!l)
        throw new Error(
          "Usage: bug-lens-cli.mjs get_request <id> [--jsonPath EXPR]",
        );
      return Ut({
        pack: u,
        id: l,
        include: ge(n, "include"),
        jsonPath: M(n, "jsonPath", "json_path") ?? o[1],
        bodyMaxChars: A(n, "bodyMaxChars", "body_max_chars"),
        format: a,
        maxChars: c,
      });
    }
    case "get_interactions": {
      let { pack: u } = L(n, r),
        o = qt({
          pack: u,
          fromIndex: A(n, "fromIndex", "from_index"),
          limit: A(n, "limit"),
          kinds: ge(n, "kinds", "kind"),
          includeScreenshot: _e(n, "includeScreenshot", "include_screenshot"),
          format: a,
          maxChars: c,
        });
      return it(o);
    }
    case "get_framework_state": {
      let { pack: u, rest: o } = L(n, r);
      return Dt({
        pack: u,
        index: A(n, "index"),
        nearMs: A(n, "nearMs", "near_ms"),
        component: M(n, "component") ?? o[0],
        path: M(n, "path", "jsonPath", "json_path"),
        format: a,
        maxChars: c,
      });
    }
    case "search_pack": {
      let { pack: u, rest: o } = L(n, r),
        l = M(n, "query", "q") ?? o[0];
      if (!l) throw new Error("Usage: bug-lens-cli.mjs search_pack <query>");
      return nn({
        pack: u,
        query: l,
        scopes: ge(n, "scopes", "scope"),
        limit: A(n, "limit"),
        contextChars: A(n, "contextChars", "context_chars"),
        format: a,
        maxChars: c,
      });
    }
    case "read_pack_file": {
      let { pack: u, rest: o } = L(n, r),
        l = M(n, "path", "file") ?? o[0];
      if (!l)
        throw new Error(
          "Usage: bug-lens-cli.mjs read_pack_file <path> [--jsonPath EXPR]",
        );
      return en({
        pack: u,
        path: l,
        jsonPath: M(n, "jsonPath", "json_path") ?? o[1],
        offset: A(n, "offset"),
        maxChars: c,
      });
    }
    case "extract_pack": {
      let { pack: u, rest: o } = L(n, r);
      return Lt({ pack: u, dest: M(n, "dest", "d") ?? o[0], format: a });
    }
    default:
      throw new Error(
        `UNKNOWN_COMMAND: Unknown command "${t}". Run with --help to see available commands.`,
      );
  }
}
function Ms() {
  if (typeof process > "u" || !Array.isArray(process.argv) || !process.argv[1])
    return !1;
  let e = process.argv[1];
  if (e.endsWith("bug-lens-cli.mjs") || e.endsWith("cli.ts")) return !0;
  try {
    let t = ws(import.meta.url),
      s = Ss(e),
      n = Fe(s) ? on(s) : s,
      r = Fe(t) ? on(t) : t;
    return n === r;
  } catch {
    return !1;
  }
}
var Ps = Ms();
if (Ps)
  try {
    let e = Es(process.argv.slice(2));
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
export { Es as runTriageCli };
