#!/usr/bin/env node
import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
import { existsSync as nt, realpathSync as Vn } from "node:fs";
import { resolve as Hr } from "node:path";
import { fileURLToPath as Kr } from "node:url";
import { readFileSync as ns } from "node:fs";
import { dirname as ss, resolve as Ae } from "node:path";
import { fileURLToPath as rs } from "node:url";
var os = "bug-lens-triage",
  Ut = [
    "open-pack",
    "derived-index",
    "timeline",
    "console-query",
    "network-query",
    "request-body",
    "interactions",
    "framework-state",
    "search",
    "raw-read",
    "extract",
  ];
var is = {
  contract: os,
  contractVersion: 0,
  implVersion: "0.0.0",
  implChannel: "legacy",
  packSchemaVersion: 0,
  workspaceNamespace: "bug-lens-workspace",
  capabilities: [...Ut],
  commands: [],
};
function as() {
  let e = ss(rs(import.meta.url));
  return [
    Ae(e, "..", "CONTRACT.json"),
    Ae(e, "CONTRACT.json"),
    Ae(
      e,
      "..",
      "..",
      "..",
      ".agents",
      "skills",
      "bug-lens-triage",
      "CONTRACT.json",
    ),
    Ae(process.cwd(), ".agents", "skills", "bug-lens-triage", "CONTRACT.json"),
  ];
}
function cs(e) {
  if (typeof e != "object" || e === null) return !1;
  let t = e;
  return (
    typeof t.contractVersion == "number" &&
    typeof t.workspaceNamespace == "string" &&
    Array.isArray(t.capabilities)
  );
}
function Ie(e = as()) {
  for (let t of e)
    try {
      let s = JSON.parse(ns(t, "utf8"));
      if (cs(s)) return s;
    } catch {}
  return { ...is, capabilities: [...Ut] };
}
function Wt(e) {
  return JSON.stringify(e, null, 2);
}
function k(e, t = 24e3, s) {
  let n = typeof t == "number" && t > 200 ? Math.floor(t) : 24e3;
  if (e.length <= n) return e;
  let r = s
      ? ` ${s}`
      : " Pass a larger maxChars or narrower filter/jsonPath to inspect further.",
    a = `

\u2026 [Truncated to ${n} chars (original ${e.length} chars).${r}]`,
    o = Math.max(100, n - a.length),
    l = e.slice(0, o),
    i = l.lastIndexOf(`
`),
    u = i > o * 0.75 ? i : o;
  return l.slice(0, u).trimEnd() + a;
}
import { createRequire as ls } from "module";
var us = ls("/"),
  fe,
  fs,
  ds;
try {
  ((fe = us("worker_threads")),
    (fs = fe.Worker),
    (ds = fe.isMarkedAsUntransferable));
} catch {}
var D = Uint8Array,
  ue = Uint16Array,
  hs = Int32Array,
  Ht = new D([
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5,
    5, 5, 5, 0, 0, 0, 0,
  ]),
  Kt = new D([
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10,
    11, 11, 12, 12, 13, 13, 0, 0,
  ]),
  ps = new D([
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
  ]),
  Gt = function (e, t) {
    for (var s = new ue(31), n = 0; n < 31; ++n) s[n] = t += 1 << e[n - 1];
    for (var r = new hs(s[30]), n = 1; n < 30; ++n)
      for (var a = s[n]; a < s[n + 1]; ++a) r[a] = ((a - s[n]) << 5) | n;
    return { b: s, r };
  },
  fe = Gt(Ht, 2),
  Xt = fe.b,
  ms = fe.r;
((Xt[28] = 258), (ms[258] = 28));
var Vt = Gt(Kt, 0),
  gs = Vt.b,
  ao = Vt.r,
  lt = new ue(32768);
for (E = 0; E < 32768; ++E)
  ((G = ((E & 43690) >> 1) | ((E & 21845) << 1)),
    (G = ((G & 52428) >> 2) | ((G & 13107) << 2)),
    (G = ((G & 61680) >> 4) | ((G & 3855) << 4)),
    (lt[E] = (((G & 65280) >> 8) | ((G & 255) << 8)) >> 1));
var G,
  E,
  we = function (e, t, s) {
    for (var n = e.length, r = 0, a = new ue(t); r < n; ++r)
      e[r] && ++a[e[r] - 1];
    var o = new ue(t);
    for (r = 1; r < t; ++r) o[r] = (o[r - 1] + a[r - 1]) << 1;
    var l;
    if (s) {
      l = new ue(1 << t);
      var i = 15 - t;
      for (r = 0; r < n; ++r)
        if (e[r])
          for (
            var u = (r << 4) | e[r],
              c = t - e[r],
              f = o[e[r] - 1]++ << c,
              p = f | ((1 << c) - 1);
            f <= p;
            ++f
          )
            l[lt[f] >> i] = u;
    } else
      for (l = new ue(n), r = 0; r < n; ++r)
        e[r] && (l[r] = lt[o[e[r] - 1]++] >> (15 - e[r]));
    return l;
  },
  $e = new D(288);
for (E = 0; E < 144; ++E) $e[E] = 8;
var E;
for (E = 144; E < 256; ++E) $e[E] = 9;
var E;
for (E = 256; E < 280; ++E) $e[E] = 7;
var E;
for (E = 280; E < 288; ++E) $e[E] = 8;
var E,
  Zt = new D(32);
for (E = 0; E < 32; ++E) Zt[E] = 5;
var E;
var ys = we($e, 9, 1);
var Ss = we(Zt, 5, 1),
  it = function (e) {
    for (var t = e[0], s = 1; s < e.length; ++s) e[s] > t && (t = e[s]);
    return t;
  },
  J = function (e, t, s) {
    var n = (t / 8) | 0;
    return ((e[n] | (e[n + 1] << 8)) >> (t & 7)) & s;
  },
  at = function (e, t) {
    var s = (t / 8) | 0;
    return (e[s] | (e[s + 1] << 8) | (e[s + 2] << 16)) >> (t & 7);
  },
  vs = function (e) {
    return ((e + 7) / 8) | 0;
  },
  ft = function (e, t, s) {
    return (
      (t == null || t < 0) && (t = 0),
      (s == null || s > e.length) && (s = e.length),
      new D(e.subarray(t, s))
    );
  };
var xs = [
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
  j = function (e, t, s) {
    var n = new Error(t || xs[e]);
    if (
      ((n.code = e),
      Error.captureStackTrace && Error.captureStackTrace(n, j),
      !s)
    )
      throw n;
    return n;
  },
  ws = function (e, t, s, n) {
    var r = e.length,
      a = n ? n.length : 0;
    if (!r || (t.f && !t.l)) return s || new D(0);
    var o = !s,
      l = o || t.i != 2,
      i = t.i;
    o && (s = new D(r * 3));
    var u = function (zt) {
        var qt = s.length;
        if (zt > qt) {
          var Jt = new D(Math.max(qt * 2, zt));
          (Jt.set(s), (s = Jt));
        }
      },
      c = t.f || 0,
      f = t.p || 0,
      p = t.b || 0,
      h = t.l,
      m = t.d,
      d = t.m,
      g = t.n,
      S = r * 8;
    do {
      if (!h) {
        c = J(e, f, 1);
        var x = J(e, f + 1, 3);
        if (((f += 3), x))
          if (x == 1) ((h = ys), (m = Ss), (d = 9), (g = 5));
          else if (x == 2) {
            var $ = J(e, f, 31) + 257,
              b = J(e, f + 10, 15) + 4,
              A = $ + J(e, f + 5, 31) + 1;
            f += 14;
            for (var I = new D(A), U = new D(19), R = 0; R < b; ++R)
              U[ps[R]] = J(e, f + R * 3, 7);
            f += b * 3;
            for (
              var K = it(U), Zn = (1 << K) - 1, Yn = we(U, K, 1), R = 0;
              R < A;
            ) {
              var Lt = Yn[J(e, f, Zn)];
              f += Lt & 15;
              var y = Lt >> 4;
              if (y < 16) I[R++] = y;
              else {
                var ce = 0,
                  Pe = 0;
                for (
                  y == 16
                    ? ((Pe = 3 + J(e, f, 3)), (f += 2), (ce = I[R - 1]))
                    : y == 17
                      ? ((Pe = 3 + J(e, f, 7)), (f += 3))
                      : y == 18 && ((Pe = 11 + J(e, f, 127)), (f += 7));
                  Pe--;
                )
                  I[R++] = ce;
              }
            }
            var Ft = I.subarray(0, $),
              ee = I.subarray($);
            ((d = it(Ft)),
              (g = it(ee)),
              (h = we(Ft, d, 1)),
              (m = we(ee, g, 1)));
          } else j(1);
        else {
          var y = vs(f) + 4,
            v = e[y - 4] | (e[y - 3] << 8),
            w = y + v;
          if (w > r) {
            i && j(0);
            break;
          }
          (l && u(p + v),
            s.set(e.subarray(y, w), p),
            (t.b = p += v),
            (t.p = f = w * 8),
            (t.f = c));
          continue;
        }
        if (f > S) {
          i && j(0);
          break;
        }
      }
      l && u(p + 131072);
      for (var Qn = (1 << d) - 1, es = (1 << g) - 1, st = f; ; st = f) {
        var ce = h[at(e, f) & Qn],
          le = ce >> 4;
        if (((f += ce & 15), f > S)) {
          i && j(0);
          break;
        }
        if ((ce || j(2), le < 256)) s[p++] = le;
        else if (le == 256) {
          ((st = f), (h = null));
          break;
        } else {
          var jt = le - 254;
          if (le > 264) {
            var R = le - 257,
              xe = Ht[R];
            ((jt = J(e, f, (1 << xe) - 1) + Xt[R]), (f += xe));
          }
          var rt = m[at(e, f) & es],
            ot = rt >> 4;
          (rt || j(3), (f += rt & 15));
          var ee = gs[ot];
          if (ot > 3) {
            var xe = Kt[ot];
            ((ee += at(e, f) & ((1 << xe) - 1)), (f += xe));
          }
          if (f > S) {
            i && j(0);
            break;
          }
          l && u(p + 131072);
          var Dt = p + jt;
          if (p < ee) {
            var Bt = a - ee,
              ts = Math.min(ee, Dt);
            for (Bt + p < 0 && j(3); p < ts; ++p) s[p] = n[Bt + p];
          }
          for (; p < Dt; ++p) s[p] = s[p - ee];
        }
      }
      ((t.l = h),
        (t.p = st),
        (t.b = p),
        (t.f = c),
        h && ((c = 1), (t.m = d), (t.d = m), (t.n = g)));
    } while (!c);
    return p != s.length && o ? ft(s, 0, p) : s.subarray(0, p);
  };
var $s = new D(0);
var W = function (e, t) {
    return e[t] | (e[t + 1] << 8);
  },
  B = function (e, t) {
    return (e[t] | (e[t + 1] << 8) | (e[t + 2] << 16) | (e[t + 3] << 24)) >>> 0;
  },
  ct = function (e, t) {
    return B(e, t) + B(e, t + 4) * 4294967296;
  };
function ks(e, t) {
  return ws(e, { i: 2 }, t && t.out, t && t.dictionary);
}
var ut = typeof TextDecoder < "u" && new TextDecoder(),
  bs = 0;
try {
  (ut.decode($s, { stream: !0 }), (bs = 1));
} catch {}
var Cs = function (e) {
  for (var t = "", s = 0; ;) {
    var n = e[s++],
      r = (n > 127) + (n > 223) + (n > 239);
    if (s + r > e.length) return { s: t, r: ft(e, s - 1) };
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
function Es(e, t) {
  if (t) {
    for (var s = "", n = 0; n < e.length; n += 16384)
      s += String.fromCharCode.apply(null, e.subarray(n, n + 16384));
    return s;
  } else {
    if (ut) return ut.decode(e);
    var r = Cs(e),
      a = r.s,
      s = r.r;
    return (s.length && j(8), a);
  }
}
var Ns = function (e, t) {
    return t + 30 + W(e, t + 26) + W(e, t + 28);
  },
  Ms = function (e, t, s) {
    var n = W(e, t + 28),
      r = W(e, t + 30),
      a = Es(e.subarray(t + 46, t + 46 + n), !(W(e, t + 8) & 2048)),
      o = t + 46 + n,
      l = Ps(e, o, r, s, B(e, t + 20), B(e, t + 24), B(e, t + 42)),
      i = l[0],
      u = l[1],
      c = l[2];
    return [W(e, t + 10), i, u, a, o + r + W(e, t + 32), c];
  },
  Ps = function (e, t, s, n, r, a, o) {
    var l = r == 4294967295,
      i = a == 4294967295,
      u = o == 4294967295,
      c = t + s,
      f = l + i + u;
    if (n && f) {
      for (; t + 4 < c; t += 4 + W(e, t + 2))
        if (W(e, t) == 1)
          return [
            l ? ct(e, t + 4 + 8 * i) : r,
            i ? ct(e, t + 4) : a,
            u ? ct(e, t + 4 + 8 * (i + l)) : o,
            1,
          ];
      n < 2 && j(13);
    }
    return [r, a, o, 0];
  };
function Yt(e, t) {
  for (var s = {}, n = e.length - 22; B(e, n) != 101010256; --n)
    (!n || e.length - n > 65558) && j(13);
  var r = W(e, n + 8);
  if (!r) return {};
  var a = B(e, n + 16),
    o = B(e, n - 20) == 117853008;
  if (o) {
    var l = B(e, n - 12);
    ((o = B(e, l) == 101075792), o && ((r = B(e, l + 32)), (a = B(e, l + 48))));
  }
  for (var i = t && t.filter, u = 0; u < r; ++u) {
    var c = Ms(e, a, o),
      f = c[0],
      p = c[1],
      h = c[2],
      m = c[3],
      d = c[4],
      g = c[5],
      S = Ns(e, g);
    ((a = d),
      (!i || i({ name: m, size: p, originalSize: h, compression: f })) &&
        (f
          ? f == 8
            ? (s[m] = ks(e.subarray(S, S + p), { out: new D(h) }))
            : j(14, "unknown compression type " + f)
          : (s[m] = ft(e, S, S + p))));
  }
  return s;
}
import { createHash as qs } from "node:crypto";
import {
  copyFileSync as Js,
  existsSync as Z,
  mkdirSync as De,
  readdirSync as ln,
  readFileSync as Be,
  realpathSync as un,
  rmSync as fn,
  statSync as yt,
  writeFileSync as te,
} from "node:fs";
import { tmpdir as Us } from "node:os";
import {
  basename as Ws,
  dirname as St,
  join as T,
  posix as Hs,
  resolve as z,
  sep as on,
} from "node:path";
var Re = class {
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
function As(e) {
  return Array.isArray(e)
    ? `array[${e.length}]`
    : e === null
      ? "null"
      : typeof e;
}
function de(e) {
  return !e || typeof e != "object" || Array.isArray(e)
    ? "\u2014"
    : Object.entries(e)
        .map(([t, s]) => `\`${t}\` (${As(s)})`)
        .join(", ");
}
function dt(e) {
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
function ht(e) {
  return e >= 1024 * 1024
    ? `${(e / 1024 / 1024).toFixed(1)} MB`
    : e >= 1024
      ? `${(e / 1024).toFixed(1)} KB`
      : `${e} B`;
}
function X(e) {
  return `"${e.replace(/(["\\$`])/g, "\\$1")}"`;
}
function V(e, t) {
  let s = e.includes("\\") && !e.includes("/") ? "\\" : "/";
  return `${e.replace(/[\\/]+$/, "")}${s}${t.split("/").join(s)}`;
}
function Is(e) {
  let t = e.listFiles(),
    s = [],
    n = new Map(),
    r = [];
  for (let a of t) {
    let o = a.path.startsWith("network/body-")
      ? "network/body-*.txt"
      : a.path.startsWith("network/blobs/")
        ? "network/blobs/*"
        : a.path.startsWith("screenshots/")
          ? "screenshots/*"
          : a.path.startsWith("issues/")
            ? "issues/*"
            : void 0;
    if (o) {
      let l = n.get(o) ?? { count: 0, bytes: 0 };
      ((l.count += 1), (l.bytes += a.byteLength), n.set(o, l));
    } else r.push(a);
  }
  (s.push(`## Files (${t.length} in original pack)`),
    s.push("| Path | Size | Note |"),
    s.push("| --- | --- | --- |"));
  for (let a of r) {
    let o = a.skippedMedia
      ? "recording (on disk only; not loaded by CLI)"
      : a.path === "data/session-data.js" ||
          a.path === "data/network-details.js"
        ? "JS wrapper \u2014 read the derived .json instead, never eval"
        : "";
    s.push(`| \`${a.path}\` | ${ht(a.byteLength)} | ${o} |`);
  }
  for (let [a, o] of n)
    s.push(`| \`${a}\` | ${ht(o.bytes)} | ${o.count} file(s) |`);
  return s;
}
function Rs(e, t) {
  let s = [],
    n = e.data,
    r = e.files.has("session-data.json"),
    a = V(t, r ? "session-data.json" : "data/session-data.json"),
    o = V(
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
    s.push(`- **Top-level keys**: ${de(n)}`));
  let l = [
    ["interactions", n.interactions],
    ["consoleSummary", n.consoleSummary],
    ["consoleEntries", n.consoleEntries ?? n.consoleLogs],
    ["networkEntries", n.networkEntries],
    ["issueScenes", n.issueScenes],
    ["frameworkStates", n.frameworkStates],
    ["screenshotSummaries", n.screenshotSummaries],
  ];
  for (let [d, g] of l)
    g &&
      s.push(`- **\`${d}\`** (${g.length} items) \u2014 item keys: ${dt(g)}`);
  (n.summary && s.push(`- **\`summary\`** keys: ${de(n.summary)}`),
    n.session && s.push(`- **\`session\`** keys: ${de(n.session)}`),
    s.push(""));
  let i = e.getNetworkDetails(),
    u = Object.keys(i);
  u.length > 0 &&
    (s.push("## network-details.json"),
    s.push(
      `- ${u.length} entries keyed by request id; entry keys: ${dt(Object.values(i))}`,
    ),
    s.push(""));
  let c = e.getNetworkEntries();
  c.length > 0 &&
    (s.push(
      `## Request \u2192 Body Map (${c.length} requests${c.length > 300 ? ", first 300 shown" : ""})`,
    ),
    s.push("| # | id | method | status | url | body |"),
    s.push("| --- | --- | --- | --- | --- | --- |"),
    c.slice(0, 300).forEach((d, g) => {
      let S = "\u2014";
      if (typeof d.response?.body == "string")
        S = `inline: networkEntries[${g}].response.body`;
      else {
        let w = d.id.replace(/[^a-zA-Z0-9._-]/g, "_"),
          $ = d.response?.bodyHash?.replace(/^sha256:/i, ""),
          A = [
            d.response?.bodyPath,
            $ ? `network/blobs/${$.slice(0, 16)}.bin` : void 0,
            $ ? `network/blobs/${$}.bin` : void 0,
            `network/body-${w}.txt`,
            `network/body-${d.id}.txt`,
          ]
            .filter((I) => typeof I == "string")
            .find((I) => e.files.has(I.replace(/^\.?\//, "")));
        A && (S = `\`${A}\``);
      }
      let x = (d.url ?? "").replace(/\|/g, "%7C"),
        y = x.length > 100 ? `${x.slice(0, 97)}...` : x,
        v = d.status ?? (d.errorText ? `ERR ${d.errorText}` : "\u2014");
      s.push(
        `| ${g} | \`${d.id}\` | ${d.method ?? "GET"} | ${v} | ${y} | ${S} |`,
      );
    }),
    s.push(""));
  let f = e
    .listFiles()
    .filter((d) => d.path.startsWith("screenshots/"))
    .map((d) => d.path);
  if (f.length > 0) {
    s.push(`## Step Screenshots (${f.length})`);
    for (let d of f.slice(0, 200)) s.push(`- \`${V(t, d)}\``);
    s.push("");
  }
  let p = e.getIssueScenes();
  if (p.length > 0) {
    s.push(`## Issue Scene Images (${p.length})`);
    for (let d of p) {
      let g = d.annotatedSource ?? d.originalSource;
      s.push(
        `- Scene [${d.index}] \`${d.id}\`: ${g ? `\`${V(t, g)}\`` : "(no image)"}`,
      );
    }
    s.push("");
  }
  let h = Array.from(e.skippedMediaFiles.entries());
  if (h.length > 0) {
    s.push("## Recording");
    for (let [d, g] of h) {
      let S = V(t, d);
      (s.push(`- \`${S}\` (${ht(g.originalSize)})`),
        s.push(
          `  - Frame at N seconds: \`ffmpeg -ss <N> -i ${X(S)} -frames:v 1 /tmp/bug-lens-frame-<N>.jpg\` (N = relativeMs / 1000)`,
        ));
    }
    s.push("");
  }
  (s.push("## Query Recipes"), s.push("```bash"));
  let m = n.consoleSummary ? "consoleSummary" : "consoleEntries";
  return (
    s.push(`jq '.${m} | length' ${X(a)}`),
    s.push(`jq '.${m}[0]' ${X(a)}`),
    s.push(
      `jq -c '.${m} | to_entries[] | select(.value.text | test("keyword")) | {i: .key, level: .value.level, text: .value.text}' ${X(a)}`,
    ),
    s.push(`jq -c '.networkEntries[] | {id, method, status, url}' ${X(a)}`),
    u.length > 0 && s.push(`jq '.["<requestId>"]' ${X(o)}`),
    s.push(`jq '.data | keys' ${X(V(t, "network/body-<id>.txt"))}`),
    s.push("```"),
    s
  );
}
function Ts(e, t) {
  let s = [],
    n = e.getScreenshotImagePath();
  return (
    s.push("- **Kind**: screenshot"),
    s.push(`- **Image**: ${n ? `\`${V(t, n)}\`` : "(none)"}`),
    s.push(
      `- **Page**: ${e.environment?.title ?? "\u2014"} (${e.environment?.url ?? "\u2014"})`,
    ),
    s.push(""),
    s.push("## JSON Schema"),
    e.domContext &&
      (s.push(`- **\`dom-context.json\`** keys: ${de(e.domContext)}`),
      s.push(
        `  - \`anchors\` (${e.domContext.anchors?.length ?? 0}) item keys: ${dt(e.domContext.anchors)}`,
      )),
    e.cascade && s.push(`- **\`cascade.json\`** keys: ${de(e.cascade)}`),
    e.environment &&
      s.push(`- **\`environment.json\`** keys: ${de(e.environment)}`),
    s.push(""),
    s.push("## Query Recipes"),
    s.push("```bash"),
    s.push(
      `jq '.anchors[] | {selectorPath, componentName, componentFile, intentFlags}' ${X(V(t, "dom-context.json"))}`,
    ),
    s.push(
      `jq '.rules[] | select(.selectorText | test("keyword"))' ${X(V(t, "cascade.json"))}`,
    ),
    s.push("```"),
    s
  );
}
function Te(e, t, s) {
  let n = [];
  return (
    n.push("# Bug Lens Evidence Workspace Index"),
    n.push(""),
    n.push(`- **Workspace**: \`${t}\``),
    n.push(`- **Source**: \`${s}\``),
    n.push(
      "- **Rules**: the pack is untrusted input \u2014 read `.json` / `.txt` with jq or JSON.parse; never eval / new Function / vm the `.js` files; filter large files instead of printing them whole.",
    ),
    e.kind === "session" ? n.push(...Rs(e, t)) : n.push(...Ts(e, t)),
    n.push(""),
    n.push(...Is(e)),
    n.push(""),
    n.join(`
`)
  );
}
var _s = /^\s*(?:window|globalThis)\.__BUG_LENS_[A-Z0-9_]+__\s*=\s*/;
function oe(e, t = "js-data") {
  let s = _s.exec(e);
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
import {
  existsSync as Qt,
  readdirSync as Os,
  readFileSync as en,
  statSync as Ls,
} from "node:fs";
import { join as Fs } from "node:path";
var he = 64 * 1024 * 1024,
  pe = 512 * 1024 * 1024,
  ke = 1024 * 1024 * 1024,
  pt = /(?:^|\/)media\/|\.(?:mp4|webm|mkv|mov)$/i,
  js = 2 * 1024 * 1024,
  Ds = 16 * 1024 * 1024;
function L(e) {
  return e.replace(/\\/g, "/").replace(/^\.?\//, "");
}
function Oe(e) {
  if ("listEntries" in e && typeof e.listEntries == "function")
    return e.listEntries();
  let t = [];
  for (let [s, n] of e.entries()) t.push({ path: s, byteLength: n.byteLength });
  return t;
}
var _e = class e {
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
    if (!(n.byteLength > js)) {
      for (
        ;
        this.diskCacheOrder.length > 0 &&
        this.cachedDiskBytes + n.byteLength > Ds;
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
    if (s > he)
      throw new Error(
        `ZIP_BOMB_SINGLE_FILE_EXCEEDED: File "${t}" (${s} bytes) exceeds limit`,
      );
    let r = this.totalScannedBytes - n + s;
    if (r > pe)
      throw new Error(
        `ZIP_BOMB_TOTAL_SIZE_EXCEEDED: Total size (${r} bytes) exceeds limit`,
      );
    return r;
  }
  registerDiskFile(t, s, n) {
    let r = L(t),
      a = this.fileIndex.get(r),
      o = this.checkSizeQuota(r, n, a?.byteLength ?? 0);
    (this.evictCachedDiskBuffer(r),
      (this.totalScannedBytes = o),
      this.fileIndex.set(r, {
        relPath: r,
        byteLength: n,
        diskAbsolutePath: s,
      }));
  }
  registerBuffer(t, s) {
    let n = L(t),
      r = this.fileIndex.get(n),
      a = this.checkSizeQuota(n, s.byteLength, r?.byteLength ?? 0);
    (this.evictCachedDiskBuffer(n),
      (this.totalScannedBytes = a),
      this.fileIndex.set(n, {
        relPath: n,
        byteLength: s.byteLength,
        inMemoryBuffer: s,
      }));
  }
  scanDirectory(t, s) {
    let n = (r, a) => {
      for (let o of Os(r, { withFileTypes: !0 })) {
        let l = L(a ? `${a}/${o.name}` : o.name),
          i = Fs(r, o.name);
        if (o.isDirectory()) n(i, l);
        else if (o.isFile()) {
          if (s?.has(l)) continue;
          let u = Ls(i);
          if (pt.test(l)) {
            this.skippedMediaFiles.set(l, {
              originalSize: u.size,
              compressedSize: u.size,
            });
            continue;
          }
          this.registerDiskFile(l, i, u.size);
        }
      }
    };
    n(t, "");
  }
  getMetadata(t) {
    return this.fileIndex.get(L(t));
  }
  has(t) {
    return this.fileIndex.has(L(t));
  }
  get(t) {
    return this.readBytes(t);
  }
  delete(t) {
    let s = L(t),
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
    let s = this.fileIndex.get(L(t));
    if (s) {
      if (s.inMemoryBuffer) return s.inMemoryBuffer;
      if (s.diskAbsolutePath && Qt(s.diskAbsolutePath))
        return new Uint8Array(en(s.diskAbsolutePath));
    }
  }
  readBytes(t) {
    let s = L(t),
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
      if (n.diskAbsolutePath && Qt(n.diskAbsolutePath)) {
        let r = new Uint8Array(en(n.diskAbsolutePath));
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
import { createHash as Bs } from "node:crypto";
var tn = [1, 2, 3, 4, 5],
  nn = 5;
function sn(e) {
  if (e)
    try {
      let t = new TextDecoder().decode(e);
      return JSON.parse(t);
    } catch {
      return;
    }
}
function rn(e, t, s) {
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
    !tn.includes(n) &&
    (n > nn
      ? (r = `Package schemaVersion (${n}) is newer than max supported version (${nn}). Reading in best-effort mode; please run 'npx skills update bug-lens-triage' if fields are missing.`)
      : (r = `Package schemaVersion (${n}) is not in standard supported list (${tn.join(", ")}). Reading in best-effort mode.`));
  let a = e.files ?? {},
    o = 0,
    l = 0,
    i = [];
  for (let [u, c] of Object.entries(a)) {
    if (s.has(u)) {
      l += 1;
      continue;
    }
    let f =
      "getMetadata" in t && typeof t.getMetadata == "function"
        ? t.getMetadata(u)
        : void 0;
    if (!t.has(u)) {
      i.push(`${u}: missing in archive`);
      continue;
    }
    o += 1;
    let p = f?.byteLength ?? t.get(u)?.byteLength;
    if (typeof c.byteLength == "number" && p !== c.byteLength) {
      i.push(`${u}: byteLength mismatch (expected ${c.byteLength}, got ${p})`);
      continue;
    }
    if (typeof c.sha256 == "string" && c.sha256.length > 0) {
      let h =
        "readBytesUncached" in t && typeof t.readBytesUncached == "function"
          ? t.readBytesUncached(u)
          : t.get(u);
      if (!h) {
        i.push(`${u}: missing in archive`);
        continue;
      }
      Bs("sha256").update(h).digest("hex").toLowerCase() !==
        c.sha256.toLowerCase() && i.push(`${u}: sha256 mismatch`);
    }
  }
  return {
    hasManifest: !0,
    valid: i.length === 0,
    schemaVersion: n,
    schemaWarning: r,
    checkedCount: o,
    skippedCount: l,
    mismatches: i,
  };
}
var Le = class {
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
    let s = L(t),
      n = this.files.get(s);
    if (n) return this.textDecoder.decode(n);
  }
  getBinaryFile(t) {
    let s = L(t);
    return this.files.get(s);
  }
  listFiles() {
    let t = Oe(this.files).map((s) => ({
      path: s.path,
      byteLength: s.byteLength,
    }));
    for (let [s, n] of this.skippedMediaFiles.entries())
      t.push({ path: s, byteLength: n.originalSize, skippedMedia: !0 });
    return t.sort((s, n) => s.path.localeCompare(n.path));
  }
};
function zs(e) {
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
var be = class {
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
          let r = zs(s.location);
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
            ...(s.isNoise ? { isNoise: !0 } : {}),
            ...(s.noiseCategory ? { noiseCategory: s.noiseCategory } : {}),
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
        a = r.id ?? s.id ?? `scene-${n + 1}`,
        o = s.originalSource ?? this.findSceneImagePath(a, "original"),
        l = s.annotatedSource ?? this.findSceneImagePath(a, "annotated");
      return {
        id: a,
        index: n,
        scene: r,
        originalSource: o,
        annotatedSource: l,
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
          let a = r instanceof Error ? r.message : String(r);
          throw new Error(`INVALID_JSON_FILE: Failed to parse ${t}: ${a}`);
        }
    }
    let s = this.files.get("data/network-details.js");
    if (!s) return ((this.networkDetailsCache = {}), this.networkDetailsCache);
    try {
      let n = this.textDecoder.decode(s);
      this.networkDetailsCache = oe(n, "data/network-details.js");
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
      let a = this.getTextFile(s);
      if (a !== void 0) return a;
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
      let i = this.getTextFile(s);
      if (i !== void 0) return i;
    }
    let n = this.resolveBlobTextByHash(t.response?.bodyHash);
    if (n !== void 0) return n;
    let a = this.getNetworkDetails()[t.id]?.bodyBlob,
      o = this.resolveBlobTextByHash(a?.hash, a?.path);
    if (o !== void 0) return o;
    let l = t.id.replace(/[^a-zA-Z0-9._-]/g, "_");
    return (
      this.getTextFile(`network/body-${l}.txt`) ??
      this.getTextFile(`network/body-${t.id}.txt`)
    );
  }
  getTextFile(t) {
    let s = L(t),
      n = this.files.get(s);
    if (n) return this.textDecoder.decode(n);
  }
  getBinaryFile(t) {
    let s = L(t);
    return this.files.get(s);
  }
  listFiles() {
    let t = Oe(this.files).map((s) => ({
      path: s.path,
      byteLength: s.byteLength,
    }));
    for (let [s, n] of this.skippedMediaFiles.entries())
      t.push({ path: s, byteLength: n.originalSize, skippedMedia: !0 });
    return t.sort((s, n) => s.path.localeCompare(n.path));
  }
};
var Ks = 10,
  Ce = ".bug-lens-extract.json",
  Y = "INDEX.md",
  ze = [
    { source: "data/session-data.js", target: "data/session-data.json" },
    { source: "data/network-details.js", target: "data/network-details.json" },
  ],
  Gs = new Set([Ce, Y, ...ze.map((e) => e.target)]),
  an = 1,
  Xs = /[:*?"<>|]/g,
  Vs = new Re(3);
function ne() {
  let e =
    process.env.BUG_LENS_WORKSPACE_DIR || process.env.BUG_LENS_CLI_WORKSPACE;
  return e ? z(e) : T(Us(), Ie().workspaceNamespace);
}
function Zs(e) {
  let s =
      Ws(e)
        .replace(/\.zip$/i, "")
        .replace(/[^a-zA-Z0-9._-]+/g, "_")
        .replace(/^[_.]+|_+$/g, "")
        .slice(0, 80) || "pack",
    n = qs("sha1").update(e).digest("hex").slice(0, 6);
  return T(ne(), `${s}-${n}`);
}
function q(e) {
  try {
    return yt(e.packPath).isDirectory() ? e.packPath : void 0;
  } catch {
    return;
  }
}
function dn() {
  return T(ne(), ".current-pack");
}
function Fe(e) {
  try {
    let t = dn();
    (De(St(t), { recursive: !0 }), te(t, e, "utf8"));
  } catch {}
}
function Ys() {
  try {
    let e = dn();
    if (Z(e)) {
      let t = Be(e, "utf8").trim();
      if (t.length > 0) return t;
    }
  } catch {}
}
function mt(e) {
  let t = e.replace(/\\/g, "/").replace(/^\.?\//, ""),
    s = Hs.normalize(t);
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
function Qs(e, t) {
  let s = new Map(),
    n = new Set(),
    r = 0,
    a;
  try {
    a = Yt(e, {
      filter(u) {
        let c = mt(u.name);
        if (c.endsWith("/")) return !1;
        let f = u.originalSize ?? 0,
          p = u.size ?? 0;
        if (pt.test(c)) {
          if (!t) return (s.set(c, { originalSize: f, compressedSize: p }), !1);
          if (f > ke)
            throw new Error(
              `ZIP_BOMB_SINGLE_FILE_EXCEEDED: Media entry "${c}" uncompressed size (${f} bytes) exceeds limit (${ke} bytes)`,
            );
          return (n.add(c), !0);
        }
        if (f > he)
          throw new Error(
            `ZIP_BOMB_SINGLE_FILE_EXCEEDED: Entry "${c}" uncompressed size (${f} bytes) exceeds limit (${he} bytes)`,
          );
        if (((r += f), r > pe))
          throw new Error(
            `ZIP_BOMB_TOTAL_SIZE_EXCEEDED: Total uncompressed size (${r} bytes) exceeds limit (${pe} bytes)`,
          );
        return !0;
      },
    });
  } catch (u) {
    if (
      u instanceof Error &&
      (u.message.startsWith("ZIP_BOMB_") ||
        u.message.startsWith("UNSAFE_ZIP_ENTRY_PATH:"))
    )
      throw u;
    let c = u instanceof Error ? u.message : String(u);
    throw new Error(`CORRUPT_ZIP_ARCHIVE: Failed to decompress ZIP: ${c}`);
  }
  let o = new Map(),
    l = new Map(),
    i = 0;
  for (let [u, c] of Object.entries(a)) {
    let f = mt(u);
    if (!f.endsWith("/")) {
      if (n.has(f)) {
        if (c.byteLength > ke)
          throw new Error(
            `ZIP_BOMB_SINGLE_FILE_EXCEEDED: Decompressed media "${f}" (${c.byteLength} bytes) exceeds limit (${ke} bytes)`,
          );
        l.set(f, c);
        continue;
      }
      if (c.byteLength > he)
        throw new Error(
          `ZIP_BOMB_SINGLE_FILE_EXCEEDED: Decompressed "${f}" (${c.byteLength} bytes) exceeds limit (${he} bytes)`,
        );
      if (((i += c.byteLength), i > pe))
        throw new Error(
          `ZIP_BOMB_TOTAL_SIZE_EXCEEDED: Total decompressed size (${i} bytes) exceeds limit (${pe} bytes)`,
        );
      o.set(f, c);
    }
  }
  return { files: o, media: l, skippedMediaFiles: s };
}
function er(e) {
  let t = new _e(e);
  return (
    t.scanDirectory(e, Gs),
    { files: t, skippedMediaFiles: t.skippedMediaFiles }
  );
}
function ie(e) {
  try {
    let t = Be(T(e, Ce), "utf8"),
      s = JSON.parse(t);
    return s && typeof s == "object" ? s : void 0;
  } catch {
    return;
  }
}
function je(e) {
  let t = ie(e);
  if (t)
    try {
      ((t.lastAccessedAt = Date.now()),
        te(T(e, Ce), JSON.stringify(t, null, 2), "utf8"));
    } catch {}
}
function tr() {
  let e = process.env.BUG_LENS_MAX_PACKS;
  if (e) {
    let t = Number.parseInt(e, 10);
    if (Number.isFinite(t) && t >= 1) return t;
  }
  return Ks;
}
function cn(e, t) {
  try {
    if (!Z(e)) return;
    let s = tr(),
      n = (o) => {
        try {
          return un(o);
        } catch {
          return z(o);
        }
      },
      r = n(t),
      a = [];
    for (let o of ln(e, { withFileTypes: !0 })) {
      if (!o.isDirectory()) continue;
      let l = n(z(e, o.name)),
        i = ie(l);
      if (!i || typeof i.source != "string") continue;
      let u =
        typeof i.lastAccessedAt == "number" && Number.isFinite(i.lastAccessedAt)
          ? i.lastAccessedAt
          : (() => {
              try {
                return yt(T(l, Ce)).mtimeMs;
              } catch {
                return 0;
              }
            })();
      a.push({ dir: l, lastAccessedAt: u });
    }
    if (a.length <= s) return;
    a.sort((o, l) =>
      o.dir === r ? -1 : l.dir === r ? 1 : l.lastAccessedAt - o.lastAccessedAt,
    );
    for (let o of a.slice(s))
      if (o.dir !== r)
        try {
          fn(o.dir, { recursive: !0, force: !0 });
        } catch {}
  } catch {}
}
function nr(e) {
  if (e.includes("/") || e.includes("\\")) return;
  let t = e
    .replace(/\.zip$/i, "")
    .trim()
    .toLowerCase();
  if (!t) return;
  let s = ne();
  if (!Z(s)) return;
  let n,
    r = -1,
    a = -1;
  try {
    for (let o of ln(s, { withFileTypes: !0 })) {
      if (!o.isDirectory()) continue;
      let l = z(s, o.name),
        i = ie(l);
      if (!i || typeof i.source != "string") continue;
      let u = o.name.toLowerCase(),
        c = u === t ? 2 : u.includes(t) ? 1 : 0;
      if (c === 0) continue;
      let f = i.lastAccessedAt ?? 0;
      (c > r || (c === r && f > a)) && ((n = l), (r = c), (a = f));
    }
  } catch {
    return;
  }
  return n;
}
function gt(e) {
  let { files: t, skippedMediaFiles: s } = er(e),
    n = new Set(),
    r = ie(e)?.renamedPaths ?? [];
  if (r.length > 0) {
    n.add("data/session-data.js");
    for (let a of r) n.add(a.from);
  }
  return hn(e, t, s, n);
}
function sr(e, t, s) {
  let n = ie(s);
  if (
    n &&
    n.version === an &&
    n.source === e &&
    n.sourceMtimeMs === t.mtimeMs &&
    n.sourceSize === t.size
  )
    return (je(s), cn(ne(), s), gt(s));
  let { files: r, media: a } = Qs(new Uint8Array(Be(e)), !0);
  (hn(e, r, new Map()), fn(s, { recursive: !0, force: !0 }));
  let o = new Map([...r, ...a]),
    { renamedPaths: l } = pn(o, s);
  xt(s);
  let i = Date.now(),
    u = {
      version: an,
      source: e,
      sourceMtimeMs: t.mtimeMs,
      sourceSize: t.size,
      renamedPaths: l,
      extractedAt: new Date(i).toISOString(),
      lastAccessedAt: i,
    };
  te(T(s, Ce), JSON.stringify(u, null, 2), "utf8");
  let c = gt(s);
  return (te(T(s, Y), Te(c, s, e), "utf8"), cn(ne(), s), c);
}
function M(e, t = Vs) {
  let s =
    e && typeof e == "string" && e.trim().length > 0
      ? e.trim()
      : (t.getLastPath() ?? Ys());
  if (!s)
    throw new Error(
      'INVALID_PACK_PATH: pack path is required when no pack has been opened yet. Pass the "pack" argument or call open_pack first.',
    );
  let n = z(s);
  if (!Z(n)) {
    let c = nr(s);
    c && (n = c);
  }
  let r, a;
  try {
    ((r = un(n)), (a = yt(r)));
  } catch (c) {
    let f = c instanceof Error ? c.message : String(c);
    throw new Error(`PACK_NOT_FOUND: Cannot access "${s}": ${f}`);
  }
  if (a.isDirectory()) {
    let c = ie(r),
      f = c ? `${c.sourceMtimeMs}:${c.sourceSize}:${c.extractedAt}` : "0",
      p = `dir:${a.mtimeMs}:${f}`,
      h = t.get(r, p);
    if (h) return (je(r), Fe(r), h);
    try {
      xt(r, !0);
    } catch {}
    let m = gt(r);
    try {
      let d = T(r, Y);
      if (!Z(d)) {
        let g = c?.source ?? r;
        te(d, Te(m, r, g), "utf8");
      }
    } catch {}
    return (je(r), t.set(r, p, m), Fe(r), m);
  }
  let o = Zs(r),
    l = `zip:${a.mtimeMs}:${a.size}`,
    i = t.get(o, l);
  if (i) return (je(o), Fe(o), i);
  let u = sr(r, a, o);
  return (t.set(o, l, u), Fe(o), u);
}
function hn(e, t, s, n) {
  let r = new TextDecoder(),
    a = sn(t.get("manifest.json")),
    o = new Set([...s.keys(), ...(n ?? [])]),
    l = rn(a, t, o),
    i = t.has("session-data.json")
      ? "session-data.json"
      : !t.has("data/session-data.js") && t.has("data/session-data.json")
        ? "data/session-data.json"
        : void 0;
  if (i) {
    let p = t.get(i);
    if (p) {
      let h;
      try {
        h = JSON.parse(r.decode(p));
      } catch (m) {
        let d = m instanceof Error ? m.message : String(m);
        throw new Error(`INVALID_JSON_FILE: Failed to parse ${i}: ${d}`);
      }
      return new be({
        packPath: e,
        manifest: a,
        integrity: l,
        data: h,
        files: t,
        skippedMediaFiles: s,
      });
    }
  }
  let u = t.get("data/session-data.js");
  if (u) {
    let p = r.decode(u),
      h = oe(p, "data/session-data.js");
    return new be({
      packPath: e,
      manifest: a,
      integrity: l,
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
    let p = (x) => {
        let y = t.get(x);
        if (y)
          try {
            return JSON.parse(r.decode(y));
          } catch (v) {
            let w = v instanceof Error ? v.message : String(v);
            throw new Error(`INVALID_JSON_FILE: Failed to parse ${x}: ${w}`);
          }
      },
      h = p("dom-context.json"),
      m = p("environment.json"),
      d = p("cascade.json"),
      g = t.get("ai-prompt.md"),
      S = g ? r.decode(g) : void 0;
    return new Le({
      packPath: e,
      manifest: a,
      integrity: l,
      domContext: h,
      environment: m,
      cascade: d,
      aiPrompt: S,
      files: t,
      skippedMediaFiles: s,
    });
  }
  let f = Array.from(t.keys()).slice(0, 10).join(", ");
  throw new Error(
    `UNRECOGNIZED_BUG_LENS_PACK: Archive does not contain "session-data.json", "data/session-data.js", or "dom-context.json". Found files: [${f}]`,
  );
}
function vt(e) {
  let t = mt(e),
    n = t
      .split("/")
      .map((r) => r.replace(Xs, "_").replace(/[. ]+$/, "_"))
      .join("/");
  return { sanitized: n, renamed: n !== t };
}
function pn(e, t) {
  De(t, { recursive: !0 });
  let s = [],
    n = new Map();
  for (let i of e.keys()) {
    let { sanitized: u, renamed: c } = vt(i);
    c && (s.push({ from: i, to: u }), n.set(i, u));
  }
  let r = [],
    a = new TextDecoder(),
    o = new TextEncoder(),
    l = t.endsWith(on) ? t : t + on;
  for (let [i, u] of e.entries()) {
    let c = n.get(i) ?? i,
      f = z(t, ...c.split("/"));
    if (f !== t && !f.startsWith(l))
      throw new Error(
        `UNSAFE_ZIP_ENTRY_PATH: Target path escapes destination root: ${i}`,
      );
    De(St(f), { recursive: !0 });
    let p = u;
    if (i === "data/session-data.js" && n.size > 0) {
      let h = a.decode(u);
      for (let [m, d] of n.entries()) h = h.split(m).join(d);
      p = o.encode(h);
    }
    (te(f, p), r.push(c));
  }
  return { writtenFiles: r.sort(), renamedPaths: s };
}
function xt(e, t = !1) {
  let s = T(e, "data", "session-data.js");
  if (!Z(s)) return [];
  let n = [];
  for (let { source: r, target: a } of ze) {
    let o = T(e, ...r.split("/")),
      l = T(e, ...a.split("/"));
    if (Z(o)) {
      if (t && Z(l)) {
        n.push(a);
        continue;
      }
      try {
        let i = oe(Be(o, "utf8"), r);
        (te(l, JSON.stringify(i, null, 2), "utf8"), n.push(a));
      } catch {}
    }
  }
  return n;
}
function mn(e, t, s, n) {
  let r = e.files.has("reproduce.spec.ts") ? z(t, "reproduce.spec.ts") : void 0,
    a = e.files.has("report.html") ? z(t, "report.html") : void 0,
    o = e.kind === "screenshot" ? e.getScreenshotImagePath() : void 0,
    l = o ? z(t, o) : void 0;
  return {
    destDir: t,
    writtenFiles: s,
    renamedPaths: n,
    reproduceSpecPath: r,
    reportHtmlPath: a,
    screenshotPath: l,
  };
}
function gn(e, t) {
  let s = ie(t)?.renamedPaths ?? [],
    n = e
      .listFiles()
      .map((r) => r.path)
      .sort();
  return mn(e, t, n, s);
}
function yn(e, t) {
  let s =
      e.kind === "session"
        ? e.sessionId.slice(0, 8) || "session"
        : "screenshot",
    n = z(t ?? T(ne(), s)),
    { writtenFiles: r, renamedPaths: a } = pn(e.files, n),
    o = q(e);
  if (o)
    for (let l of e.skippedMediaFiles.keys()) {
      let i = T(o, ...l.split("/")),
        u = T(n, ...l.split("/"));
      Z(i) &&
        z(i) !== z(u) &&
        (De(St(u), { recursive: !0 }), Js(i, u), r.push(l));
    }
  xt(n);
  try {
    te(T(n, Y), Te(e, n, e.packPath), "utf8");
  } catch {}
  return mn(e, n, r.sort(), a);
}
import {
  existsSync as rr,
  mkdirSync as or,
  writeFileSync as ir,
} from "node:fs";
import { dirname as ar, join as cr, resolve as Sn } from "node:path";
var lr = Math.floor(1.5 * 1024 * 1024);
function wt(e) {
  let t = e.toLowerCase();
  return t.endsWith(".png")
    ? "image/png"
    : t.endsWith(".webp")
      ? "image/webp"
      : t.endsWith(".gif")
        ? "image/gif"
        : "image/jpeg";
}
function qe(e, t) {
  let s = e.getBinaryFile(t);
  if (!s) return;
  let { sanitized: n } = vt(t),
    r = q(e);
  if (r) {
    let l = Sn(r, ...n.split("/"));
    if (rr(l)) return l;
  }
  let a =
      e.kind === "session"
        ? e.sessionId.slice(0, 8) || "session"
        : "screenshot",
    o = Sn(cr(ne(), "images", a, n));
  try {
    return (or(ar(o), { recursive: !0 }), ir(o, s), o);
  } catch {
    return;
  }
}
function F(e, t, s) {
  let n = e.getBinaryFile(t);
  if (!n) return [{ type: "text", text: `[Image not found in pack: ${t}]` }];
  let r = wt(t),
    a = (n.byteLength / 1024).toFixed(1),
    o = qe(e, t);
  if (n.byteLength > lr)
    return [
      {
        type: "text",
        text: o
          ? `[Image "${t}" (${a} KB) saved to: ${o} \u2014 call read_file on this path to view it directly]`
          : `[Image "${t}" (${a} KB) exceeds inline size limit (1.5 MB) and could not be located on disk.]`,
      },
    ];
  let l = Buffer.from(n).toString("base64"),
    i = [],
    u = o ? ` -> Saved to: ${o}` : "";
  return (
    s &&
      i.push({
        type: "text",
        text: `${s} (${t}, ${a} KB, ${r})${u} (Tip: call read_file on the saved image path to view the visual image directly)`,
      }),
    i.push({ type: "image", data: l, mimeType: r }),
    i
  );
}
function vn(e, t) {
  if (e.byteLength < 24) return;
  let s = wt(t);
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
        a = (e[n + 2] << 8) | e[n + 3];
      if (
        (r >= 192 && r <= 195) ||
        (r >= 197 && r <= 199) ||
        (r >= 201 && r <= 203) ||
        (r >= 205 && r <= 207)
      ) {
        let o = (e[n + 5] << 8) | e[n + 6];
        return { width: (e[n + 7] << 8) | e[n + 8], height: o };
      }
      if (a < 2) break;
      n += 2 + a;
    }
  }
}
function ur(e, t) {
  if (e.byteLength !== t.byteLength) return !1;
  for (let s = 0; s < e.byteLength; s += 1) if (e[s] !== t[s]) return !1;
  return !0;
}
function me(e, t, s = !1) {
  let n = e.getInteractions()[t - 1],
    r = s ? n?.screenshots?.settledPath : n?.screenshots?.instantPath;
  if (r && e.files.has(r)) return r;
  let a = s ? "-settled" : "";
  for (let o of ["jpg", "png", "jpeg", "webp"]) {
    let l = `screenshots/step-${t}${a}.${o}`;
    if (e.files.has(l)) return l;
  }
}
function $t(e) {
  let t = e.data.summary?.finalFramePath;
  if (t && e.files.has(t)) return t;
  for (let s of ["jpg", "png", "jpeg", "webp"]) {
    let n = `screenshots/final-frame.${s}`;
    if (e.files.has(n)) return n;
  }
}
function fr(e) {
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
function xn(e) {
  let t = M(e.pack);
  if (t.kind !== "session")
    throw new Error(
      `UNSUPPORTED_PACK_KIND: compare_frames requires a session evidence pack, but "${e.pack}" is a screenshot pack.`,
    );
  let s = e.left,
    n = e.right,
    r = "Left frame",
    a = "Right frame";
  if (!s || !n)
    if (e.from !== void 0)
      ((s = s ?? me(t, e.from, !1)),
        (r = `Step ${e.from} (instant)`),
        e.to !== void 0
          ? ((n = n ?? me(t, e.to, !1)), (a = `Step ${e.to} (instant)`))
          : e.final
            ? ((n = n ?? $t(t)), (a = "Final frame"))
            : ((n = n ?? me(t, e.from, !0)), (a = `Step ${e.from} (settled)`)));
    else {
      let S = e.step ?? fr(t) ?? 1;
      ((s = s ?? me(t, S, !1)), (r = `Step ${S} (instant)`));
      let x = e.against?.trim().toLowerCase();
      if (e.final || x === "final" || x === "final-frame")
        ((n = n ?? $t(t)), (a = "Final frame"));
      else if (x && /^\d+$/.test(x)) {
        let y = Number(x);
        ((n = n ?? me(t, y, !1)), (a = `Step ${y} (instant)`));
      } else if (x && x !== "settled" && t.files.has(e.against))
        ((n = e.against), (a = e.against));
      else if (
        ((n = n ?? me(t, S, !0)),
        (a = `Step ${S} (settled)`),
        !n && !e.settled && !e.against)
      ) {
        let y = $t(t);
        y && ((n = y), (a = "Final frame"));
      }
    }
  if (!s || !t.files.has(s))
    throw new Error(
      `FRAME_NOT_FOUND: Left comparison image not found (${s ?? "unspecified"}). Pass --step N or --from A --to B.`,
    );
  if (!n || !t.files.has(n))
    throw new Error(
      `FRAME_NOT_FOUND: Right comparison image (${a}) not found in pack (${n ?? "unspecified"}).`,
    );
  let o = t.getBinaryFile(s),
    l = t.getBinaryFile(n),
    i = ur(o, l),
    u = l.byteLength - o.byteLength,
    c = Math.max(1, o.byteLength, l.byteLength),
    f = Number(((Math.abs(u) / c) * 100).toFixed(2)),
    p = vn(o, s),
    h = vn(l, n),
    m = !!(p && h && (p.width !== h.width || p.height !== h.height)),
    d;
  if (e.format === "json")
    d = k(
      JSON.stringify(
        {
          left: {
            path: s,
            label: r,
            byteLength: o.byteLength,
            dimensions: p ?? null,
          },
          right: {
            path: n,
            label: a,
            byteLength: l.byteLength,
            dimensions: h ?? null,
          },
          identicalBytes: i,
          byteDelta: u,
          sizeDeltaPct: f,
          resolutionChanged: m,
        },
        null,
        2,
      ),
      e.maxChars,
    );
  else {
    let S = [
      `# Frame Comparison: ${r} vs ${a}`,
      `- **Left**: \`${s}\` (${o.byteLength} B${p ? `, ${p.width}x${p.height}` : ""})`,
      `- **Right**: \`${n}\` (${l.byteLength} B${h ? `, ${h.width}x${h.height}` : ""})`,
      `- **Identical Bytes**: ${i ? "true (no pixel/encoding change between captures)" : "false"}`,
      `- **Byte Delta**: ${u >= 0 ? `+${u}` : u} B (${f}% size difference)`,
      `- **Resolution Changed**: ${m}`,
    ];
    d = k(
      S.join(`
`),
      e.maxChars,
    );
  }
  let g = [{ type: "text", text: d }];
  return (
    (e.includeImage ?? !0) &&
      g.push(...F(t, s, `[Before] ${r}`), ...F(t, n, `[After] ${a}`)),
    g
  );
}
var dr = ["id", "key", "name", "fieldKey", "code"];
function kt(e) {
  return typeof e == "object" && e !== null && !Array.isArray(e);
}
function hr(e, t) {
  let s = [...e, ...t];
  if (s.length === 0 || !s.every((r) => kt(r))) return;
  let n = (r, a) => {
    let o = new Set();
    for (let l of r) {
      let i = l[a];
      if (typeof i != "string" && typeof i != "number") return !1;
      let u = String(i);
      if (!u || o.has(u)) return !1;
      o.add(u);
    }
    return !0;
  };
  for (let r of dr) if (n(e, r) && n(t, r)) return r;
}
function pr(e) {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(e)
    ? `.${e}`
    : `[${JSON.stringify(e)}]`;
}
function Ee(e, t, s = {}) {
  let n = s.ignoreKeys ?? new Set(),
    r = Math.max(1, s.maxDiffs ?? 80),
    a = [],
    o = 0,
    l = (u) => {
      ((o += 1), a.length < r && a.push(u));
    },
    i = (u, c, f) => {
      if (!Object.is(u, c)) {
        if (Array.isArray(u) && Array.isArray(c)) {
          let p = hr(u, c);
          if (p) {
            let m = new Map();
            for (let g of c) m.set(String(g[p]), g);
            let d = new Set();
            for (let g of u) {
              let S = String(g[p]);
              d.add(S);
              let x = `${f}[${p}=${JSON.stringify(S)}]`;
              m.has(S)
                ? i(g, m.get(S), x)
                : l({ path: x, kind: "removed", left: g });
            }
            for (let g of c) {
              let S = String(g[p]);
              d.has(S) ||
                l({
                  path: `${f}[${p}=${JSON.stringify(S)}]`,
                  kind: "added",
                  right: g,
                });
            }
            return;
          }
          let h = Math.max(u.length, c.length);
          for (let m = 0; m < h; m += 1) {
            let d = `${f}[${m}]`;
            m >= u.length
              ? l({ path: d, kind: "added", right: c[m] })
              : m >= c.length
                ? l({ path: d, kind: "removed", left: u[m] })
                : i(u[m], c[m], d);
          }
          return;
        }
        if (kt(u) && kt(c)) {
          let p = new Set([...Object.keys(u), ...Object.keys(c)]);
          for (let h of p) {
            if (n.has(h)) continue;
            let m = f ? `${f}${pr(h)}` : h,
              d = Object.prototype.hasOwnProperty.call(u, h) && u[h] !== void 0,
              g = Object.prototype.hasOwnProperty.call(c, h) && c[h] !== void 0;
            d && !g
              ? l({ path: m, kind: "removed", left: u[h] })
              : !d && g
                ? l({ path: m, kind: "added", right: c[h] })
                : d && g && i(u[h], c[h], m);
          }
          return;
        }
        l({ path: f || "$", kind: "changed", left: u, right: c });
      }
    };
  return (
    i(e, t, ""),
    { changes: a, totalChanges: o, truncated: o > a.length }
  );
}
function se(e, t = 140) {
  let s;
  if (typeof e == "string") s = JSON.stringify(e);
  else
    try {
      s = JSON.stringify(e);
    } catch {
      s = String(e);
    }
  return s === void 0
    ? "undefined"
    : s.length > t
      ? `${s.slice(0, t - 1)}\u2026`
      : s;
}
function wn(e, t, s = 80) {
  let n = e.split(/\r?\n/),
    r = t.split(/\r?\n/),
    a = [],
    o = 0,
    l = 0,
    i = 0;
  for (; l < n.length || i < r.length;) {
    if (l < n.length && i < r.length && n[l] === r[i]) {
      ((l += 1), (i += 1));
      continue;
    }
    let u = -1,
      c = -1,
      f = 20;
    e: for (let m = 1; m <= f; m += 1)
      for (let d = 0; d <= m; d += 1) {
        let g = m - d;
        if (l + d < n.length && i + g < r.length && n[l + d] === r[i + g]) {
          ((u = l + d), (c = i + g));
          break e;
        }
      }
    let p = u !== -1 ? u : n.length,
      h = c !== -1 ? c : r.length;
    for (; l < p; l += 1)
      ((o += 1),
        a.length < s &&
          a.push({ lineNumberLeft: l + 1, kind: "removed", text: n[l] }));
    for (; i < h; i += 1)
      ((o += 1),
        a.length < s &&
          a.push({ lineNumberRight: i + 1, kind: "added", text: r[i] }));
  }
  return { hunks: a, totalHunks: o, truncated: o > a.length };
}
function bt(e, t = {}) {
  let s = t.maxDepth ?? 3,
    n = t.maxKeysPerLevel ?? 16,
    r = [],
    a = (o, l, i) => {
      if (o == null) return o;
      if (typeof o != "object")
        return typeof o == "string" && o.length > 60
          ? `string(${o.length})`
          : o;
      if (Array.isArray(o)) {
        if (o.length === 0) return "Array[0]";
        if (l >= s) return `Array[${o.length}]`;
        let f = a(o[0], l + 1, `${i}[0]`);
        return { _type: `Array[${o.length}]`, sample0: f };
      }
      let u = Object.entries(o);
      if (l >= s)
        return `Object{${u.length} keys: ${u
          .slice(0, 6)
          .map(([f]) => f)
          .join(", ")}${u.length > 6 ? ", \u2026" : ""}}`;
      let c = {};
      for (let [f, p] of u.slice(0, n)) {
        let h = i ? `${i}.${f}` : f;
        (r.length < 4 &&
          l <= 1 &&
          p !== null &&
          typeof p == "object" &&
          r.push(h),
          (c[f] = a(p, l + 1, h)));
      }
      return (
        u.length > n && (c.__moreKeys = `+${u.length - n} keys omitted`),
        c
      );
    };
  return { outline: a(e, 0, ""), suggestedJsonPaths: r };
}
function N(e) {
  if (typeof e != "number" || !Number.isFinite(e)) return "\u2014";
  let t = e >= 0 ? "+" : "-",
    s = Math.abs(e) / 1e3;
  return `${t}${s.toFixed(1)}s`;
}
function re(e) {
  return typeof e != "number" || !Number.isFinite(e)
    ? "\u2014"
    : e < 1e3
      ? `${Math.round(e)}ms`
      : `${(e / 1e3).toFixed(2)}s`;
}
function mr(e) {
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
        let o =
          /^(?:\?\(\s*)?(?:@\.)?([a-zA-Z0-9_$-]+)\s*={1,3}\s*(.+?)(?:\s*\))?$/.exec(
            a,
          );
        if (o) {
          let l = o[1].trim(),
            i = o[2].trim().replace(/^['"]|['"]$/g, "");
          s.push({ kind: "filter", field: l, value: i });
        } else {
          let l = a.replace(/^['"]|['"]$/g, "");
          s.push({ kind: "prop", key: l });
        }
      }
    }
  return s;
}
function Q(e, t) {
  let s = mr(t);
  if (s.length === 0) return e;
  let n = [e],
    r = !1;
  for (let a of s) {
    let o = [];
    for (let l of n)
      if (l != null) {
        if (a.kind === "prop") {
          if (typeof l == "object" && !Array.isArray(l)) {
            let i = l[a.key];
            i !== void 0 && o.push(i);
          }
        } else if (a.kind === "index") {
          if (Array.isArray(l)) {
            let i = a.index < 0 ? l.length + a.index : a.index;
            i >= 0 && i < l.length && o.push(l[i]);
          }
        } else if (a.kind === "wildcard")
          ((r = !0),
            Array.isArray(l)
              ? o.push(...l)
              : typeof l == "object" && o.push(...Object.values(l)));
        else if (a.kind === "filter" && ((r = !0), Array.isArray(l))) {
          for (let i of l)
            if (i && typeof i == "object") {
              let u = i[a.field];
              String(u) === a.value && o.push(i);
            }
        }
      }
    n = o;
  }
  return r ? n : n.length === 1 ? n[0] : n;
}
var gr = new Set([
    "script",
    "stylesheet",
    "image",
    "font",
    "media",
    "manifest",
    "other",
  ]),
  yr = new Set(["xhr", "fetch", "websocket", "eventsource"]),
  Sr = [
    "text/css",
    "application/javascript",
    "text/javascript",
    "application/x-javascript",
    "image/",
    "font/",
    "audio/",
    "video/",
    "application/font",
  ],
  vr =
    /\.(?:m?js|cjs|css|woff2?|ttf|otf|eot|png|jpe?g|webp|avif|gif|svg|ico|mp[34]|webm|wav|map)$/i;
function xr(e) {
  if (!e) return "";
  try {
    return new URL(e, "https://localhost").pathname;
  } catch {
    return e.split(/[?#]/)[0] ?? "";
  }
}
function Ct(e) {
  let t = (e.type ?? "").toLowerCase();
  if (yr.has(t)) return !1;
  if (t && gr.has(t) && t !== "other") return !0;
  let s = (e.mimeType ?? "").toLowerCase();
  if (s && Sr.some((r) => s.startsWith(r))) return !0;
  let n = xr(e.url);
  return !!(n && vr.test(n));
}
function $n(e) {
  if (e.isFailure) return !1;
  let t = e.status ?? 0;
  if (t <= 0 || t >= 400 || e.hasBody) return !1;
  let s = e.byteLength ?? 0,
    n = (e.bodyStatus ?? "").toLowerCase();
  return s === 0 && (n === "not-present" || t === 304 || n === "")
    ? Ct({ url: e.url, type: e.type, mimeType: e.mimeType })
    : !1;
}
var ae = new Set([
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
  Et =
    /err|fail|invalid|denied|timeout|reject|not_found|unauthor|forbidden|exception/i,
  wr = new Set(["image", "font", "media", "stylesheet"]),
  $r = [
    "image/",
    "font/",
    "audio/",
    "video/",
    "text/css",
    "application/javascript",
    "text/javascript",
  ];
function kr(e) {
  let t = e.message ?? e.msg ?? e.errorMsg ?? e.error;
  if (typeof t == "string") return t;
  if (t && typeof t == "object" && "message" in t) {
    let s = t.message;
    return typeof s == "string" ? s : JSON.stringify(t);
  }
}
function Je(e) {
  return e != null && e !== "" && typeof e != "boolean" && !ae.has(e);
}
function br(e) {
  let t = /"(?:success|isSuccess)"\s*:\s*false/i.test(e),
    s = /"(?:errorCode|errCode)"\s*:\s*(?:"([^"\\]+)"|(-?[1-9]\d*))/.exec(e),
    n = /"(?:code|retCode)"\s*:\s*(?:"([^"\\]+)"|(0|-?[1-9]\d*))/.exec(e),
    r = s?.[1] ?? s?.[2],
    a = r !== void 0 && r.length > 0 && !ae.has(r),
    o = n?.[1] ?? n?.[2],
    l =
      o !== void 0 &&
      o.length > 0 &&
      !ae.has(o) &&
      (/-?[1-9]\d{2,}|-\d+/.test(o) || Et.test(o));
  if (!t && !a && !l) return;
  let i = (a ? r : void 0) ?? (l ? o : void 0) ?? n?.[1] ?? n?.[2] ?? "FAIL";
  if (ae.has(i) && !t)
    return { isBizError: !1, matchedRule: "heuristic_regex_success" };
  let u =
    /"(?:message|msg|errorMsg|error)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/.exec(e);
  return {
    isBizError: !0,
    code: i,
    message: u ? u[1] : void 0,
    matchedRule: "heuristic_regex",
  };
}
function kn(e) {
  let t = e.trim();
  if (!t.startsWith("{") && !t.startsWith("["))
    return { isBizError: !1, matchedRule: "not_json" };
  try {
    let s = JSON.parse(t);
    if (!s || typeof s != "object" || Array.isArray(s))
      return { isBizError: !1, matchedRule: "primitive_json" };
    let n = s,
      r = kr(n);
    if (n.success === !1 || n.isSuccess === !1 || n.result === !1)
      return {
        isBizError: !0,
        code: n.code ?? n.errCode ?? n.errorCode ?? n.result ?? "FAIL",
        message: r,
        matchedRule: "explicit_success_false",
      };
    let a = n.errorCode ?? n.errCode;
    if (Je(a))
      return {
        isBizError: !0,
        code: a,
        message: r,
        matchedRule: "explicit_error_code",
      };
    let o = n.success === !0 || n.isSuccess === !0,
      l = n.code ?? n.retCode;
    if (Je(l) && !o)
      return {
        isBizError: !0,
        code: l,
        message: r,
        matchedRule: "abnormal_code_value",
      };
    if (
      !o &&
      l === void 0 &&
      (typeof n.result == "number" || typeof n.result == "string") &&
      Je(n.result) &&
      (typeof n.result == "number" || Et.test(n.result))
    )
      return {
        isBizError: !0,
        code: n.result,
        message: r,
        matchedRule: "abnormal_result_value",
      };
    if (!o && n.status !== void 0 && n.status !== null) {
      if (typeof n.status == "number" && !ae.has(n.status))
        return {
          isBizError: !0,
          code: n.status,
          message: r,
          matchedRule: "abnormal_status_number",
        };
      if (
        typeof n.status == "string" &&
        !ae.has(n.status) &&
        !ae.has(n.status.toLowerCase()) &&
        Et.test(n.status)
      )
        return {
          isBizError: !0,
          code: n.status,
          message: r,
          matchedRule: "abnormal_status_string",
        };
    }
    let i =
      n.error && typeof n.error == "object" && Object.keys(n.error).length > 0;
    if (
      (typeof n.error == "string" && n.error.length > 0) ||
      (typeof n.exception == "string" && n.exception.length > 0) ||
      i
    ) {
      let u =
          typeof n.error == "string"
            ? n.error
            : typeof n.exception == "string"
              ? n.exception
              : (n.error?.message ?? JSON.stringify(n.error)),
        c = i ? n.error.code : void 0;
      return {
        isBizError: !0,
        code: (Je(l) ? l : void 0) ?? c ?? "EXCEPTION",
        message: u,
        matchedRule: "exception_field_present",
      };
    }
  } catch {
    let s = br(e);
    if (s) return s;
  }
  return { isBizError: !1, matchedRule: "none" };
}
function Ue(e) {
  let t = e.status ?? 0;
  return t === 0 || t >= 400 || !!e.errorText;
}
function Nt(e, t, s = {}) {
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
  if (r && wr.has(r))
    return { isBizError: !1, matchedRule: "skipped_non_api_type" };
  let a = (t.response?.mimeType ?? "").toLowerCase();
  if (a && $r.some((l) => a.startsWith(l)))
    return { isBizError: !1, matchedRule: "skipped_non_json_mime" };
  if (
    s.maxScanBytes !== void 0 &&
    typeof t.response?.byteLength == "number" &&
    t.response.byteLength > s.maxScanBytes &&
    typeof t.response?.body != "string"
  )
    return { isBizError: !1, matchedRule: "skipped_size_limit" };
  let o = e.getNetworkBody(t);
  return o ? kn(o) : { isBizError: !1, matchedRule: "no_body" };
}
function Mt(e, t, s = !1) {
  return t?.isBizError
    ? `${e} [BIZ_ERR: code=${t.code ?? "ERR"}]`
    : s
      ? `!${e}`
      : String(e);
}
function Cr(e, t, s) {
  if (!t || t === "all") return !0;
  if (t === "biz_error") return !!s?.isBizError;
  let n = e.status ?? 0;
  return t === "failed"
    ? Ue(e)
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
function Ne(e, t = {}) {
  let s = e.getNetworkEntries(),
    n = t.urlContains?.toLowerCase(),
    r = t.method?.toUpperCase(),
    a = t.type?.toLowerCase(),
    o = !!(t.bizError || t.bizCode || t.status === "biz_error"),
    l = t.bizCode
      ? t.bizCode
          .split(",")
          .map((h) => h.trim().toLowerCase())
          .filter(Boolean)
      : [],
    i = [],
    u = 0,
    c = 0;
  for (let h of s) {
    if (
      (n && !h.url.toLowerCase().includes(n)) ||
      (r && (h.method ?? "GET").toUpperCase() !== r) ||
      (a && (h.type ?? "").toLowerCase() !== a) ||
      (t.status && t.status !== "biz_error" && !Cr(h, t.status))
    )
      continue;
    let m = h.status ?? 0,
      d = Nt(e, h, { allowBodyScan: o });
    if (t.bizError && !d.isBizError) continue;
    if (l.length > 0) {
      if (!d.isBizError) continue;
      let w = String(d.code ?? "").toLowerCase();
      if (!l.some(($) => w.includes($))) continue;
    }
    if (t.status === "biz_error" && !d.isBizError) continue;
    let S = Ue(h) || d.isBizError,
      x =
        !!h.response?.bodyPath ||
        !!h.response?.bodyHash ||
        typeof h.response?.body == "string" ||
        h.response?.bodyStatus === "captured",
      y =
        h.isStaticAsset ??
        Ct({ url: h.url, type: h.type, mimeType: h.response?.mimeType }),
      v =
        h.isBenignStatic ??
        $n({
          url: h.url,
          type: h.type,
          mimeType: h.response?.mimeType,
          status: m,
          byteLength: h.response?.byteLength,
          bodyStatus: h.response?.bodyStatus,
          hasBody: x,
          isFailure: S,
        });
    if ((v && (c += 1), t.apiOnly && !S && (y || v))) {
      u += 1;
      continue;
    }
    i.push({
      id: h.id,
      relativeMs: e.toRelativeMs(h.createdAt),
      method: h.method ?? "GET",
      status: m,
      durationMs: h.durationMs,
      type: h.type,
      url: h.url,
      mimeType: h.response?.mimeType,
      bodyStatus: h.response?.bodyStatus,
      byteLength: h.response?.byteLength,
      hasBody: x,
      isFailure: S,
      ...(y ? { isStaticAsset: !0 } : {}),
      ...(v ? { isBenignStatic: !0 } : {}),
      isBizError: d.isBizError ? !0 : void 0,
      bizErrorCode: d.code,
      bizErrorMessage: d.message,
    });
  }
  !t.status &&
    !t.bizError &&
    i.sort((h, m) => {
      if (h.isFailure !== m.isFailure) return h.isFailure ? -1 : 1;
      let d = !!h.isBenignStatic,
        g = !!m.isBenignStatic;
      return d !== g ? (d ? 1 : -1) : (h.relativeMs ?? 0) - (m.relativeMs ?? 0);
    });
  let f = Math.max(0, t.offset ?? 0),
    p = Math.max(1, t.limit ?? 50);
  return {
    totalEntries: s.length,
    matchedCount: i.length,
    hiddenStaticCount: u,
    staticNoBodyCount: c,
    offset: f,
    limit: p,
    items: i.slice(f, f + p),
  };
}
function We(e) {
  let t = N(e.relativeMs),
    s = re(e.durationMs),
    n = Mt(
      e.status,
      { isBizError: !!e.isBizError, code: e.bizErrorCode },
      e.isFailure && !e.isBizError,
    ),
    r = e.hasBody
      ? `[body:${e.byteLength ?? "?"}B]`
      : `[${e.bodyStatus ?? "no-body"}]`,
    a = e.bizErrorMessage ? ` (bizError: ${e.bizErrorMessage})` : "";
  return `${e.id} | ${t} | ${e.method} ${n} (${s}) | ${e.type ?? "?"} | ${r} | ${e.url}${a}`;
}
function He(e, t) {
  let s = e.getNetworkEntries(),
    n =
      s.find((r) => r.id === t) ??
      s.find((r) => r.id.endsWith(t) || r.url.includes(t));
  if (!n)
    throw new Error(
      `REQUEST_NOT_FOUND: No network entry found matching "${t}". Call query_network first to list available entry IDs.`,
    );
  return n;
}
function bn(e, t, s = {}) {
  let n = He(e, t),
    r = new Set(
      s.include && s.include.length > 0
        ? s.include
        : ["summary", "headers", "initiator", "body"],
    ),
    a = e.getNetworkDetails(),
    o =
      r.has("headers") || r.has("initiator") || r.has("body")
        ? a[n.id]
        : void 0,
    l,
    i,
    u = !1,
    c;
  if (r.has("body") || s.jsonPath) {
    let f = e.getNetworkBody(n);
    if (f !== void 0)
      if (
        ((n.status ?? 0) >= 200 && (n.status ?? 0) < 300 && (c = kn(f)),
        s.jsonPath)
      )
        try {
          let p = JSON.parse(f);
          i = Q(p, s.jsonPath);
        } catch (p) {
          let h = p instanceof Error ? p.message : String(p);
          throw new Error(
            `INVALID_RESPONSE_JSON: Cannot evaluate jsonPath "${s.jsonPath}" because response body is not valid JSON (${h})`,
          );
        }
      else {
        let p = s.bodyMaxChars ?? 8e3;
        f.length > p ? ((l = f.slice(0, p)), (u = !0)) : (l = f);
      }
  }
  return {
    entry: n,
    relativeMs: e.toRelativeMs(n.createdAt),
    details: o,
    bodyText: l,
    extractedJson: i,
    bodyTruncated: u,
    bizError: c,
  };
}
function ge(e) {
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
function Ke(e, t, s) {
  let n = e?.request,
    r =
      ge(t?.requestBody) ??
      ge(t?.postData) ??
      ge(e?.requestBody) ??
      ge(e?.postData) ??
      ge(n?.postData) ??
      ge(n?.body);
  if (r !== void 0) return r;
  if (!s) return;
  let a = typeof n?.bodyHash == "string" ? n.bodyHash : void 0,
    o = t?.requestBodyBlob;
  return s.resolveBlobTextByHash(a ?? o?.hash, o?.path);
}
function Er(e, t = 4e3) {
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
function Cn(e) {
  let t = M(e.pack);
  if (t.kind !== "session")
    throw new Error(
      `UNSUPPORTED_PACK_KIND: get_request requires a session evidence pack, but "${e.pack}" is a screenshot pack.`,
    );
  let s = bn(t, e.id, {
    include: e.include,
    jsonPath: e.jsonPath,
    bodyMaxChars: e.bodyMaxChars,
  });
  if (e.format === "json") {
    let c = Ke(s.entry, s.details, t),
      f = { ...s, resolvedRequestBody: c };
    return k(JSON.stringify(f, null, 2), e.maxChars);
  }
  let { entry: n, details: r } = s,
    a = q(t),
    o = a && n.response?.bodyPath ? `${a}/${n.response.bodyPath}` : void 0,
    l = new Set(
      e.include && e.include.length > 0
        ? e.include
        : ["summary", "headers", "initiator", "body"],
    ),
    i = [];
  if (
    (l.has("summary") &&
      (i.push(`# Request \`${n.id}\` (${n.method ?? "GET"} ${n.status ?? 0})`),
      i.push(`- **URL**: ${n.url}`),
      i.push(
        `- **Time**: ${N(s.relativeMs)} | Duration: ${re(n.durationMs)} | Type: ${n.type ?? "\u2014"}`,
      ),
      i.push(
        `- **Response Info**: mimeType=${n.response?.mimeType ?? "\u2014"}, bodyStatus=${n.response?.bodyStatus ?? "\u2014"}, byteLength=${n.response?.byteLength ?? "\u2014"}, bodyPath=${o ? `\`${o}\`` : (n.response?.bodyPath ?? "inline/none")}`,
      ),
      n.errorText && i.push(`- **Error**: ${n.errorText}`)),
    l.has("headers"))
  ) {
    let c = r?.requestHeaders ?? n.request?.headers,
      f = r?.responseHeaders ?? n.response?.headers;
    (c &&
      Object.keys(c).length > 0 &&
      (i.push(`
## Request Headers`),
      i.push(JSON.stringify(c, null, 2))),
      f &&
        Object.keys(f).length > 0 &&
        (i.push(`
## Response Headers`),
        i.push(JSON.stringify(f, null, 2))));
  }
  if (l.has("body") || l.has("headers")) {
    let c = Ke(n, r, t);
    c !== void 0 &&
      (i.push(`
## Request Body`),
      i.push(Er(c, 4e3)));
  }
  if (
    (l.has("initiator") &&
      r?.initiator &&
      (i.push(`
## Initiator`),
      i.push(JSON.stringify(r.initiator, null, 2).slice(0, 3e3))),
    e.jsonPath !== void 0)
  )
    (i.push(`
## Extracted Response Body (jsonPath: \`${e.jsonPath}\`)`),
      i.push(JSON.stringify(s.extractedJson, null, 2)));
  else if (l.has("body")) {
    if (
      (i.push(`
## Response Body`),
      s.bodyText === void 0)
    )
      i.push("(No response body captured for this entry)");
    else if (e.outline) {
      let c = t.getNetworkBody(n) ?? s.bodyText;
      try {
        let f = JSON.parse(c),
          { outline: p, suggestedJsonPaths: h } = bt(f);
        (i.push(`\`\`\`json
${JSON.stringify(p, null, 2)}
\`\`\``),
          h.length > 0 &&
            i.push(
              `- **Suggested jsonPath queries**: ${h.map((m) => `\`${m}\``).join(", ")}`,
            ));
      } catch {
        i.push(s.bodyText);
      }
    } else if ((i.push(s.bodyText), s.bodyTruncated)) {
      let c = "data";
      try {
        let m = t.getNetworkBody(n);
        if (m) {
          let d = JSON.parse(m),
            { outline: g, suggestedJsonPaths: S } = bt(d, {
              maxDepth: 2,
              maxKeysPerLevel: 10,
            });
          (S.length > 0 && (c = S[0]),
            i.push(`
### Response JSON Outline (auto-generated for truncated payload)`),
            i.push(`\`\`\`json
${JSON.stringify(g, null, 2)}
\`\`\``));
        }
      } catch {}
      let f =
          !o && a && n.response?.bodyHash
            ? `${a}/network/blobs/${n.response.bodyHash.replace(/^sha256:/i, "").slice(0, 16)}.bin`
            : void 0,
        p =
          o ??
          f ??
          (a
            ? `${a}/${t.files.has("session-data.json") ? "session-data.json" : "data/session-data.json"}`
            : void 0),
        h = p ? ` Or query \`${p}\` directly with \`jq\` / \`read_file\`.` : "";
      i.push(`
\u2026 [Response body truncated at ${e.bodyMaxChars ?? 8e3} chars. Pass \`jsonPath\` (e.g. "${c}") or a higher \`bodyMaxChars\` to inspect further.${h}]`);
    }
  }
  return k(
    i.join(`
`),
    e.maxChars,
  );
}
function Nr(e) {
  if (e === void 0) return { isJson: !1, raw: void 0 };
  let t = e.trim();
  if (!t) return { isJson: !1, raw: e };
  if (
    (t.startsWith("{") && t.endsWith("}")) ||
    (t.startsWith("[") && t.endsWith("]"))
  )
    try {
      return { isJson: !0, value: JSON.parse(t), raw: e };
    } catch {
      return { isJson: !1, raw: e };
    }
  return { isJson: !1, raw: e };
}
function En(e, t, s, n) {
  let r = e.getNetworkDetails()[t.id];
  if (s === "headers")
    return {
      isJson: !0,
      value: {
        requestHeaders: r?.requestHeaders ?? t.request?.headers ?? {},
        responseHeaders: r?.responseHeaders ?? t.response?.headers ?? {},
      },
    };
  let a = s === "request" ? Ke(t, r, e) : e.getNetworkBody(t),
    o = Nr(a);
  return n && o.isJson ? { isJson: !0, value: Q(o.value, n) } : o;
}
function Nn(e) {
  let t = M(e.pack);
  if (t.kind !== "session")
    throw new Error(
      `UNSUPPORTED_PACK_KIND: compare_requests requires a session evidence pack, but "${e.pack}" is a screenshot pack.`,
    );
  let s = He(t, e.left),
    n = He(t, e.right),
    r = e.part ?? "response",
    a = new Set(e.ignoreKeys ?? []),
    o = Math.max(1, e.maxDiffs ?? 80),
    i = (r === "both" ? ["request", "response", "headers"] : [r]).map((c) => {
      let f = En(t, s, c, e.jsonPath),
        p = En(t, n, c, e.jsonPath);
      if (f.raw === void 0 && !f.isJson && p.raw === void 0 && !p.isJson)
        return {
          section: c,
          mode: "empty",
          identical: !0,
          changes: [],
          totalChanges: 0,
          truncated: !1,
        };
      if (f.isJson && p.isJson) {
        let m = Ee(f.value, p.value, { ignoreKeys: a, maxDiffs: o });
        return {
          section: c,
          mode: "json",
          identical: m.totalChanges === 0,
          changes: m.changes,
          totalChanges: m.totalChanges,
          truncated: m.truncated,
        };
      }
      let h = wn(
        f.raw ?? (f.isJson ? JSON.stringify(f.value, null, 2) : ""),
        p.raw ?? (p.isJson ? JSON.stringify(p.value, null, 2) : ""),
        o,
      );
      return {
        section: c,
        mode: "text",
        identical: h.totalHunks === 0,
        hunks: h.hunks,
        totalChanges: h.totalHunks,
        truncated: h.truncated,
      };
    });
  if (e.format === "json")
    return k(
      JSON.stringify(
        {
          left: {
            id: s.id,
            method: s.method ?? "GET",
            status: s.status ?? 0,
            relativeMs: t.toRelativeMs(s.createdAt),
            url: s.url,
          },
          right: {
            id: n.id,
            method: n.method ?? "GET",
            status: n.status ?? 0,
            relativeMs: t.toRelativeMs(n.createdAt),
            url: n.url,
          },
          part: r,
          ...(e.jsonPath ? { jsonPath: e.jsonPath } : {}),
          sections: i,
        },
        null,
        2,
      ),
      e.maxChars,
    );
  let u = [];
  (u.push(
    `# Request Diff (\`${s.id}\` vs \`${n.id}\`, part=\`${r}\`${e.jsonPath ? `, jsonPath=\`${e.jsonPath}\`` : ""})`,
  ),
    u.push(
      `- **Left**: ${s.method ?? "GET"} ${s.status ?? 0} (${N(t.toRelativeMs(s.createdAt))}) | ${s.url}`,
    ),
    u.push(
      `- **Right**: ${n.method ?? "GET"} ${n.status ?? 0} (${N(t.toRelativeMs(n.createdAt))}) | ${n.url}`,
    ));
  for (let c of i) {
    if (
      (u.push(`
## Section: ${c.section} (${c.mode}, ${c.totalChanges} difference(s))`),
      c.mode === "empty")
    ) {
      u.push(`(No ${c.section} payload captured on either request)`);
      continue;
    }
    if (c.identical) {
      u.push(`(Identical ${c.section} content)`);
      continue;
    }
    if (c.mode === "json") {
      (u.push("| Kind | Path | Left | Right |"),
        u.push("| --- | --- | --- | --- |"));
      for (let f of c.changes) {
        let p = f.kind === "added" ? "\u2014" : se(f.left),
          h = f.kind === "removed" ? "\u2014" : se(f.right);
        u.push(`| ${f.kind} | \`${f.path}\` | \`${p}\` | \`${h}\` |`);
      }
    } else
      for (let f of c.hunks) {
        let p =
          f.kind === "removed"
            ? `- [L${f.lineNumberLeft}]`
            : `+ [R${f.lineNumberRight}]`;
        u.push(`${p} ${f.text}`);
      }
    c.truncated &&
      u.push(`
\u2026 (${c.totalChanges - (c.mode === "json" ? c.changes.length : c.hunks.length)} more differences omitted; pass a narrower \`--jsonPath\` or higher \`--maxDiffs\`)`);
  }
  return k(
    u.join(`
`),
    e.maxChars,
  );
}
function Mn(e) {
  let t = M(e.pack),
    s = q(t),
    n = !e.dest && s ? gn(t, s) : yn(t, e.dest);
  if (e.format === "json") return k(JSON.stringify(n, null, 2));
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
var Pt =
  /^(?:word-break|overflow-wrap|word-wrap|white-space|white-space-collapse|text-wrap|text-wrap-mode|text-overflow|overflow|overflow-x|overflow-y|display|width|max-width|min-width|height|max-height|min-height|flex|flex-grow|flex-shrink|flex-basis|flex-wrap|flex-direction|-webkit-line-clamp|line-clamp|position|z-index)$/i;
function Ge(e) {
  if (!e) return [];
  let t = new Map(),
    s = (a) => {
      if (!a) return;
      let o = {};
      for (let [l, i] of Object.entries(a))
        Pt.test(l) &&
          i !== void 0 &&
          i !== "" &&
          i !== "normal" &&
          i !== "auto" &&
          i !== "none" &&
          i !== "visible" &&
          i !== "static" &&
          (o[l] = i);
      return Object.keys(o).length > 0 ? o : void 0;
    },
    n = (a, o) => {
      let l = a.selector || a.tagName || "element",
        i = a.selectorPath,
        u = a.componentName,
        c = a.componentFile,
        f = a.componentLine,
        p = u ? `${u}${c ? ` @ ${c}${f ? `:${f}` : ""}` : ""}` : void 0,
        h = a.layoutContext ?? {},
        m = h.textOverflow ?? a.textOverflow,
        d = h.flexSqueezeRisk ?? a.flexSqueezeRisk,
        g = h.gridSelf ?? a.gridSelf,
        S = a.computedStyles,
        x =
          typeof a.innerText == "string"
            ? a.innerText.replace(/\s+/g, " ").trim().slice(0, 80)
            : void 0;
      if (m && m.isTruncated) {
        let y = m.scrollDimension ?? {},
          v = m.clientDimension ?? {},
          w = m.overflowDelta ?? {},
          $ = String(m.truncationType ?? "truncated"),
          b = `text_overflow|${l}|${$}|${v.width ?? 0}x${v.height ?? 0}`,
          A = t.get(b);
        A
          ? o !== void 0 &&
            !A.anchorIndices.includes(o) &&
            A.anchorIndices.push(o)
          : t.set(b, {
              kind: "text_overflow",
              selector: l,
              selectorPath: i,
              component: p,
              anchorIndices: o !== void 0 ? [o] : [],
              summary: `${$} truncation (scroll ${y.width ?? "?"}x${y.height ?? "?"}px > client ${v.width ?? "?"}x${v.height ?? "?"}px, delta +${w.width ?? 0}px W / +${w.height ?? 0}px H)`,
              sampleText: x,
              keyStyles: s(S),
            });
      }
      if (d && d.isSqueezed) {
        let y = `flex_squeeze|${l}|${d.renderedWidth ?? 0}`,
          v = t.get(y);
        v
          ? o !== void 0 &&
            !v.anchorIndices.includes(o) &&
            v.anchorIndices.push(o)
          : t.set(y, {
              kind: "flex_squeeze",
              selector: l,
              selectorPath: i,
              component: p,
              anchorIndices: o !== void 0 ? [o] : [],
              summary: `Flex squeeze (intrinsic ${d.intrinsicWidth ?? "?"}px -> rendered ${d.renderedWidth ?? "?"}px, flex-shrink=${d.flexShrink ?? "?"})`,
              sampleText: x,
              keyStyles: s(S),
            });
      }
      if (g && g.isGridOverflow) {
        let y = `grid_overflow|${l}`,
          v = t.get(y);
        v
          ? o !== void 0 &&
            !v.anchorIndices.includes(o) &&
            v.anchorIndices.push(o)
          : t.set(y, {
              kind: "grid_overflow",
              selector: l,
              selectorPath: i,
              component: p,
              anchorIndices: o !== void 0 ? [o] : [],
              summary: String(g.reason ?? "Grid item overflowed track"),
              sampleText: x,
              keyStyles: s(S),
            });
      }
    };
  (e.anchors ?? []).forEach((a, o) => {
    n(a, o);
  });
  let r = (a) => {
    if (!a) return;
    n(a);
    let o = a.children;
    if (Array.isArray(o)) for (let l of o) r(l);
  };
  return (e.tree && r(e.tree), Array.from(t.values()));
}
function Mr(e, t) {
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
function Pr(e) {
  let t = [];
  if (e.styleProps && Object.keys(e.styleProps).length > 0)
    for (let [s, n] of Object.entries(e.styleProps))
      Pt.test(s) && t.push(`${s}: ${n}`);
  else if (e.cssText) {
    let s = e.cssText.match(/\{([\s\S]*)\}/),
      n = s ? s[1] : e.cssText;
    for (let r of n.split(";")) {
      let a = r.trim();
      if (!a) continue;
      let o = a.indexOf(":");
      if (o > 0) {
        let l = a.slice(0, o).trim();
        Pt.test(l) && t.push(a);
      }
    }
  }
  return t;
}
function Pn(e) {
  if (!e) return [];
  let t = e.sheets ?? [],
    s = e.rules ?? [],
    n = e.elements ?? [],
    r = new Map();
  for (let f of t) r.set(f.id, f);
  let a = new Map();
  for (let f of s) a.set(f.id, f);
  let o = [],
    l =
      e.meta?.pruned &&
      typeof e.meta.totalRuleCount == "number" &&
      e.meta.totalRuleCount > s.length
        ? `${s.length} matched rules (pruned from ${e.meta.totalRuleCount})`
        : `${s.length} rules`;
  o.push(`
## CSS Cascade Index (${t.length} stylesheets, ${l}, ${n.length} indexed elements)`);
  let i = new Set();
  for (let f of n)
    for (let p of f.matchedRuleIds ?? []) {
      let h = a.get(p);
      h && i.add(h.sheetId);
    }
  let u = t.filter((f) => !!f.href && (i.size === 0 || i.has(f.id))),
    c = t.filter((f) => !f.href).length;
  if (u.length > 0 || c > 0) {
    o.push("### Active Stylesheets (referenced by captured elements)");
    for (let f of u.slice(0, 12))
      o.push(`- \`${f.id}\`: ${f.href} (${f.rulesCount ?? 0} rules)`);
    (u.length > 12 && o.push(`- ... +${u.length - 12} more active stylesheets`),
      c > 0 && o.push(`- \`inline <style>\`: ${c} inline style tag(s)`));
  }
  if (n.length > 0) {
    o.push("### Indexed Elements & Key Layout/Wrapping Rule Overrides");
    let f = new Map(),
      p = [];
    n.forEach((h, m) => {
      let d = `${h.tagName}|${(h.matchedRuleIds ?? []).join(",")}`,
        g = f.get(d);
      g ? g.push(h.id) : (f.set(d, [h.id]), p.push({ idx: m, el: h, sig: d }));
    });
    for (let { idx: h, el: m, sig: d } of p.slice(0, 12)) {
      let g = m.matchedRuleIds ?? [],
        S = f.get(d) ?? [m.id],
        x = S.length > 1 ? ` (also ${S.slice(1).join(", ")})` : "",
        y = new Map();
      for (let v of g) {
        let w = a.get(v);
        if (!w) continue;
        let $ = Pr(w);
        if ($.length === 0) continue;
        let b = `${w.selectorText}||${$.join(";")}`,
          A = Mr(w.sheetId, r),
          I = y.get(b);
        I
          ? (I.ruleIds.push(v), I.sheetRefs.add(A))
          : y.set(b, {
              rule: w,
              decls: $,
              ruleIds: [v],
              sheetRefs: new Set([A]),
            });
      }
      o.push(
        `- **[${h}] \`${m.id}\`${x} \`<${m.tagName}>\` \`${m.selector}\`** (${g.length} matched rules)`,
      );
      for (let v of y.values()) {
        let w =
            v.ruleIds.length > 1
              ? `${v.ruleIds[0]} (+${v.ruleIds.length - 1})`
              : v.ruleIds[0],
          $ = Array.from(v.sheetRefs).slice(0, 2).join(", ");
        o.push(
          `  - [${w} @ ${$}] \`${v.rule.selectorText}\` -> \`${v.decls.join("; ")}\``,
        );
      }
    }
    p.length > 12 &&
      o.push(
        `- ... +${p.length - 12} more elements (call \`get_scene(selector="...")\` or \`search_pack\` to inspect)`,
      );
  }
  return o;
}
function Xe(e, t, s) {
  let n = [],
    r = s.selector?.trim().toLowerCase(),
    a = s.cssProperty?.trim().toLowerCase(),
    o = a ? new RegExp(a, "i") : void 0,
    l = e?.anchors ?? [],
    i = [];
  (l.forEach((f, p) => {
    if (!r) {
      i.push({ idx: p, anchor: f });
      return;
    }
    `${p} ${f.selector ?? ""} ${f.selectorPath ?? ""} ${f.tagName ?? ""} ${f.componentName ?? ""} ${f.componentFile ?? ""} ${f.innerText ?? ""}`
      .toLowerCase()
      .includes(r) && i.push({ idx: p, anchor: f });
  }),
    n.push(`## Matched DOM Anchors (${i.length} of ${l.length})`));
  let u = new Map(),
    c = [];
  for (let f of i) {
    let p = f.anchor,
      h = p.layoutContext?.textOverflow?.truncationType,
      m = `${p.selectorPath ?? p.selector}|${p.componentName ?? ""}|${h ?? ""}|${JSON.stringify(p.intentFlags ?? {})}`,
      d = u.get(m);
    d
      ? (d.push(f.idx),
        r && i.length <= 10 && c.push({ ...f, sig: `${m}#${f.idx}` }))
      : (u.set(m, [f.idx]), c.push({ ...f, sig: m }));
  }
  for (let { idx: f, anchor: p, sig: h } of c.slice(0, 30)) {
    let m = u.get(h) ?? [f],
      d =
        m.length > 1
          ? ` (and ${m.length - 1} identical sibling anchor(s): [${m.slice(1, 8).join(", ")}${m.length > 8 ? ", ..." : ""}])`
          : "",
      g = p.componentName
        ? ` [${p.componentName}${p.componentFile ? ` @ ${p.componentFile}:${p.componentLine ?? ""}` : ""}]`
        : "";
    if (
      (n.push(
        `- **[${f}] \`${p.selectorPath ?? p.selector ?? "?"}\`**${g}${d}`,
      ),
      p.intentFlags &&
        Object.keys(p.intentFlags).length > 0 &&
        n.push(`  - flags: ${JSON.stringify(p.intentFlags)}`),
      p.innerText &&
        n.push(
          `  - text: "${p.innerText.replace(/\s+/g, " ").trim().slice(0, 140)}"`,
        ),
      p.relativeRect && n.push(`  - rect: ${JSON.stringify(p.relativeRect)}`),
      p.boxModel && n.push(`  - boxModel: ${JSON.stringify(p.boxModel)}`),
      p.computedStyles && Object.keys(p.computedStyles).length > 0)
    ) {
      let S = o
        ? Object.fromEntries(
            Object.entries(p.computedStyles).filter(
              ([x, y]) => o.test(x) || o.test(y),
            ),
          )
        : p.computedStyles;
      n.push(`  - computedStyles: ${JSON.stringify(S)}`);
    }
    p.layoutContext &&
      Object.keys(p.layoutContext).length > 0 &&
      n.push(`  - layoutContext: ${JSON.stringify(p.layoutContext)}`);
  }
  if (t) {
    let f = t.sheets ?? [],
      p = t.rules ?? [],
      h = t.elements ?? [],
      m = new Map();
    for (let S of f) m.set(S.id, S);
    let d = new Map();
    for (let S of p) d.set(S.id, S);
    let g = [];
    (h.forEach((S, x) => {
      if (!r) {
        g.push({ idx: x, el: S });
        return;
      }
      `${x} ${S.id} ${S.tagName} ${S.selector}`.toLowerCase().includes(r) &&
        g.push({ idx: x, el: S });
    }),
      n.push(`
## Matched CSS Cascade Elements (${g.length} of ${h.length})`));
    for (let { idx: S, el: x } of g.slice(0, 20)) {
      n.push(`- **[${S}] \`${x.id}\` \`<${x.tagName}>\` \`${x.selector}\`**`);
      let y = new Map();
      for (let v of x.matchedRuleIds ?? []) {
        let w = d.get(v);
        if (!w || (o && !o.test(w.cssText) && !o.test(w.selectorText)))
          continue;
        let $ = `${w.selectorText}||${w.cssText}`,
          b = m.get(w.sheetId),
          A = b?.href
            ? `${w.sheetId} (${b.href})`
            : `${w.sheetId} (inline <${b?.ownerNodeTag ?? "style"}>)`,
          I = y.get($);
        I
          ? (I.ruleIds.push(v), I.sheetHrefs.add(A))
          : y.set($, { rule: w, ruleIds: [v], sheetHrefs: new Set([A]) });
      }
      if (y.size === 0) n.push("  - (no matched rules for filter)");
      else
        for (let v of y.values()) {
          let w = v.ruleIds.join(", "),
            $ = Array.from(v.sheetHrefs).join(" | ");
          n.push(
            `  - **[${w}]** [sheet: ${$}] \`${v.rule.selectorText}\` -> \`${v.rule.cssText}\``,
          );
        }
      if (x.inheritedRules && x.inheritedRules.length > 0)
        for (let v of x.inheritedRules) {
          let w = JSON.stringify(v.inheritedProps ?? {});
          if (o && !o.test(w) && !o.test(v.ancestorSelector)) continue;
          let $ = d.get(v.ruleId),
            A = ($ ? m.get($.sheetId) : void 0)?.href ?? $?.sheetId ?? "?";
          n.push(
            `  - *[inherited from \`<${v.ancestorTagName}> ${v.ancestorSelector}\` via ${v.ruleId} @ ${A}]*: ${w}`,
          );
        }
    }
  }
  return n;
}
function An(e) {
  if (e)
    try {
      return JSON.parse(e);
    } catch {
      return;
    }
}
function In(e) {
  let t = M(e.pack);
  if (t.kind === "screenshot") {
    if (e.format === "json")
      return k(
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
    let v = Xe(t.domContext, t.cascade, {
      selector: e.selector,
      cssProperty: e.property,
    });
    return k(
      v.join(`
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
    r = n ? s.find((v) => v.id === n || String(v.index) === n) : s[0];
  if (!r) {
    let v = s.map((w) => `${w.index}:${w.id}`).join(", ");
    throw new Error(
      `SCENE_NOT_FOUND: Scene "${n}" not found. Available scenes: [${v}]`,
    );
  }
  let a = An(
      t.getTextFile(r.domStylesPath ?? `issues/${r.id}/dom-styles.json`),
    ) ?? {
      sceneId: r.id,
      targetSelector: r.targetSelector,
      computedLayoutStyles: r.scene.target?.computedStyle ?? {},
      winnerRules: r.scene.target?.winnerRules ?? [],
    },
    o = An(
      t.getTextFile(r.domContextPath ?? `issues/${r.id}/dom-context.json`),
    ),
    l = (v, ...w) => {
      if (v.length === 0) return !0;
      let $ = w.map((b) => String(b ?? "").toLowerCase());
      return v.some((b) => $.some((A) => A.includes(b)));
    },
    i = (v) =>
      v
        ? v
            .toLowerCase()
            .split("|")
            .map((w) => w.trim())
            .filter(Boolean)
        : [],
    u = i(e.selector),
    c = i(e.property),
    f = a.computedLayoutStyles ?? {},
    p =
      c.length > 0
        ? Object.fromEntries(Object.entries(f).filter(([v, w]) => l(c, v, w)))
        : f,
    h = a.winnerRules ?? [],
    m = h.filter((v) =>
      l(u, `${v.selector ?? ""} ${v.source ?? ""}`)
        ? c.length > 0
          ? Object.entries(v.properties ?? {}).some(([w, $]) => l(c, w, $))
          : !0
        : !1,
    ),
    d = o?.triggerElement ?? r.scene.target?.triggerElement,
    g = o?.relatedOverlays ?? r.scene.target?.relatedOverlays;
  if (e.format === "json")
    return k(
      JSON.stringify(
        {
          kind: "session",
          sceneId: r.id,
          sceneIndex: r.index,
          targetSelector:
            a.targetSelector ?? r.targetSelector ?? o?.targetSelector,
          computedLayoutStyles: p,
          winnerRules: m,
          ...(d ? { triggerElement: d } : {}),
          ...(g?.length ? { relatedOverlays: g } : {}),
        },
        null,
        2,
      ),
      e.maxChars,
    );
  let S = [],
    x = a.targetSelector ?? r.targetSelector ?? o?.targetSelector ?? "\u2014";
  (S.push(
    `# Winner CSS & Computed Layout Styles (Scene [${r.index}] \`${r.id}\`)`,
  ),
    S.push(`- **Target Selector**: \`${x}\``),
    d &&
      S.push(
        `- **Portal Trigger Element**: \`${d.selectorPath ?? d.tagName ?? "?"}\`${d.componentName ? ` (component: \`${d.componentName}\`)` : ""}`,
      ),
    g &&
      g.length > 0 &&
      S.push(
        `- **Related Portal Overlays (${g.length})**: ${g.map((v) => `${v.tagName ?? "div"}${v.id ? `#${v.id}` : ""} (${v.relationReason ?? "linked"})`).join(", ")}`,
      ));
  let y = Object.entries(p);
  if (
    (S.push(`
## Computed Layout Styles (${y.length})`),
    y.length === 0)
  )
    S.push("(No computed layout properties matched)");
  else for (let [v, w] of y) S.push(`- \`${v}\`: \`${w}\``);
  if (
    (S.push(`
## Winner CSS Rules (${m.length} of ${h.length})`),
    m.length === 0)
  )
    S.push("(No winner rules recorded or matched filter)");
  else
    for (let v of m) {
      S.push(
        `- **\`${v.selector}\`** \u2014 \`${v.source}\`${v.specificity ? ` (specificity: \`${v.specificity}\`)` : ""}`,
      );
      for (let [w, $] of Object.entries(v.properties ?? {}))
        l(c, w, $) && S.push(`  - \`${w}: ${$}\``);
    }
  return k(
    S.join(`
`),
    e.maxChars,
  );
}
function H(e) {
  let t = e;
  return t.componentName ?? t.name ?? "Anonymous";
}
function ye(e) {
  let t = [];
  (e.snapshot?.targetComponent && t.push(e.snapshot.targetComponent),
    e.snapshot?.rootComponent && t.push(e.snapshot.rootComponent),
    Array.isArray(e.snapshot?.parentChain) && t.push(...e.snapshot.parentChain),
    t.length === 0 && Array.isArray(e.components) && t.push(...e.components));
  let s = [];
  for (let n of t) {
    s.push(n);
    let r = n.parentComponents;
    if (Array.isArray(r)) for (let a of r) a && s.push(a);
  }
  return s;
}
function Rn(e, t) {
  let s = {},
    n = {},
    r = (a, o) => {
      if (o)
        for (let [l, i] of Object.entries(o))
          i === null ? delete a[l] : (a[l] = i);
    };
  for (let a = 0; a <= t && a < e.length; a += 1) {
    let o = e[a];
    if (o.webStorage) {
      for (let l of Object.keys(s)) delete s[l];
      for (let l of Object.keys(n)) delete n[l];
      (Object.assign(s, o.webStorage.localStorage ?? {}),
        Object.assign(n, o.webStorage.sessionStorage ?? {}));
    } else
      o.webStorageDiff &&
        (r(
          s,
          o.webStorageDiff.localStorageChanged ?? o.webStorageDiff.localStorage,
        ),
        r(
          n,
          o.webStorageDiff.sessionStorageChanged ??
            o.webStorageDiff.sessionStorage,
        ));
  }
  return { localStorage: s, sessionStorage: n };
}
function Ve(e) {
  return `${e.componentFile ?? ""}::${H(e)}`;
}
function Tn(e) {
  return {
    ...(e.props ? { props: e.props } : {}),
    ...((e.state ?? e.data) ? { state: e.state ?? e.data } : {}),
  };
}
function Ar(e, t, s, n) {
  let r = e[t],
    a = e[s],
    o = (d) => (n ? H(d).toLowerCase().includes(n) : !0),
    l = ye(r).filter(o),
    i = ye(a).filter(o),
    u = new Map();
  for (let d of l) u.has(Ve(d)) || u.set(Ve(d), d);
  let c = new Map();
  for (let d of i) c.has(Ve(d)) || c.set(Ve(d), d);
  let f = [];
  for (let [d, g] of c.entries()) {
    let S = u.get(d);
    if (!S) {
      f.push({
        componentName: H(g),
        ...(g.componentFile ? { componentFile: g.componentFile } : {}),
        status: "added",
        changes: [],
      });
      continue;
    }
    let x = Ee(Tn(S), Tn(g), { maxDiffs: 60 });
    x.totalChanges > 0 &&
      f.push({
        componentName: H(g),
        ...(g.componentFile ? { componentFile: g.componentFile } : {}),
        status: "modified",
        changes: x.changes,
      });
  }
  for (let [d, g] of u.entries())
    c.has(d) ||
      f.push({
        componentName: H(g),
        ...(g.componentFile ? { componentFile: g.componentFile } : {}),
        status: "removed",
        changes: [],
      });
  let p = Rn(e, t),
    h = Rn(e, s),
    m = Ee(p, h, { maxDiffs: 60 });
  return {
    fromIndex: t,
    toIndex: s,
    componentDiffs: f,
    storageChanges: m.changes,
  };
}
function At(e) {
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
function _n(e) {
  let t = M(e.pack);
  if (t.kind === "screenshot") {
    let c =
        t.environment?.frameworkComponentStates ??
        t.environment?.vueComponentStates ??
        [],
      f = e.component?.toLowerCase(),
      p = f
        ? c.filter((m) => (m.componentName ?? "").toLowerCase().includes(f))
        : c;
    if (e.path) return k(JSON.stringify(Q(p, e.path), null, 2), e.maxChars);
    if (e.format === "json")
      return k(
        JSON.stringify({ totalComponents: c.length, components: p }, null, 2),
        e.maxChars,
      );
    if (p.length === 0)
      return "No framework component states recorded in this screenshot pack.";
    let h = [
      `# Screenshot Pack Component States (${p.length} of ${c.length})`,
      ...p.map(
        (
          m,
        ) => `- **${m.componentName ?? "Anonymous"}** (${m.framework ?? "vue/react"})${m.componentFile ? ` @ ${m.componentFile}:${m.componentLine ?? ""}` : ""}
  - props: ${JSON.stringify(m.props ?? {})}
  - data: ${JSON.stringify(m.data ?? m.state ?? {})}`,
      ),
    ];
    return k(
      h.join(`
`),
      e.maxChars,
    );
  }
  let s = t.getFrameworkStates();
  if (s.length === 0)
    return "No frameworkStates were captured in this session pack.";
  let n = e.index;
  if (n === void 0 && e.nearMs !== void 0) {
    let c = 0,
      f = 1 / 0;
    (s.forEach((p, h) => {
      let m = t.toRelativeMs(p.capturedAtEpochMs) ?? 0,
        d = Math.abs(m - e.nearMs);
      d < f && ((f = d), (c = h));
    }),
      (n = c));
  } else if (n === void 0 && e.component) {
    let c = e.component.toLowerCase();
    for (let f = s.length - 1; f >= 0; f -= 1)
      if (ye(s[f]).some((h) => H(h).toLowerCase().includes(c))) {
        n = f;
        break;
      }
  }
  let r = n ?? s.length - 1,
    a = s[r];
  if (!a)
    throw new Error(
      `FRAMEWORK_STATE_NOT_FOUND: Index ${r} out of range (0..${s.length - 1})`,
    );
  if (e.path) {
    let c = Q(a, e.path);
    return k(
      JSON.stringify(
        {
          stateIndex: r,
          relativeMs: t.toRelativeMs(a.capturedAtEpochMs),
          path: e.path,
          value: c,
        },
        null,
        2,
      ),
      e.maxChars,
    );
  }
  let o = e.component?.toLowerCase();
  if (e.diff || e.compareFrom !== void 0 || e.compareTo !== void 0) {
    let c = e.compareTo ?? r,
      f = e.compareFrom ?? (c > 0 ? c - 1 : 0);
    if (!s[f])
      throw new Error(
        `FRAMEWORK_STATE_NOT_FOUND: compareFrom index ${f} out of range (0..${s.length - 1})`,
      );
    if (!s[c])
      throw new Error(
        `FRAMEWORK_STATE_NOT_FOUND: compareTo index ${c} out of range (0..${s.length - 1})`,
      );
    let p = Ar(s, f, c, o);
    if (e.format === "json")
      return k(
        JSON.stringify(
          {
            totalStates: s.length,
            fromRelativeMs: t.toRelativeMs(s[f].capturedAtEpochMs),
            toRelativeMs: t.toRelativeMs(s[c].capturedAtEpochMs),
            ...p,
          },
          null,
          2,
        ),
        e.maxChars,
      );
    let h = N(t.toRelativeMs(s[f].capturedAtEpochMs)),
      m = N(t.toRelativeMs(s[c].capturedAtEpochMs)),
      d = [
        `# Framework State Diff ([${f}] ${h} -> [${c}] ${m})`,
        `- **Snapshots compared**: [${f}] (\`${s[f].trigger ?? "?"}\`) -> [${c}] (\`${s[c].trigger ?? "?"}\`)`,
        `
## Component State Changes (${p.componentDiffs.length})`,
      ];
    if (p.componentDiffs.length === 0)
      d.push("(No component props/state changes between these snapshots)");
    else
      for (let g of p.componentDiffs) {
        let S = g.componentFile ? ` @ ${g.componentFile}` : "";
        d.push(`- **${g.componentName}**${S} [${g.status}]`);
        for (let x of g.changes) {
          let y = x.kind === "added" ? "\u2014" : se(x.left),
            v = x.kind === "removed" ? "\u2014" : se(x.right);
          d.push(`  - \`${x.path}\` (${x.kind}): \`${y}\` -> \`${v}\``);
        }
      }
    if (
      (d.push(`
## WebStorage Changes (${p.storageChanges.length})`),
      p.storageChanges.length === 0)
    )
      d.push("(No localStorage/sessionStorage changes)");
    else
      for (let g of p.storageChanges) {
        let S = g.kind === "added" ? "\u2014" : se(g.left),
          x = g.kind === "removed" ? "\u2014" : se(g.right);
        d.push(`- \`${g.path}\` (${g.kind}): \`${S}\` -> \`${x}\``);
      }
    return k(
      d.join(`
`),
      e.maxChars,
    );
  }
  if (e.format === "json")
    return k(
      JSON.stringify(
        {
          totalStates: s.length,
          overview: s.map((c, f) => {
            let p = At(c);
            return {
              index: f,
              relativeMs: t.toRelativeMs(c.capturedAtEpochMs),
              trigger: c.trigger,
              components: ye(c)
                .map((h) => H(h))
                .filter((h) => h !== "Anonymous"),
              localStorageKeys: Object.keys(p.local ?? {}),
              sessionStorageKeys: Object.keys(p.session ?? {}),
              hasWebStorageDiff: p.isDiff,
            };
          }),
          selectedIndex: r,
          selectedState: a,
        },
        null,
        2,
      ),
      e.maxChars,
    );
  let l = [];
  (l.push(`# Framework States (${s.length} snapshots in pack)`),
    l.push(`
## Snapshot Index Overview`),
    s.forEach((c, f) => {
      let p = t.toRelativeMs(c.capturedAtEpochMs),
        h = ye(c)
          .map((y) => H(y))
          .filter((y) => y !== "Anonymous"),
        m = At(c),
        d = Object.keys(m.local ?? {}),
        g = Object.keys(m.session ?? {}),
        S = m.isDiff ? "diff" : "keys",
        x = f === r ? " <-- [SELECTED]" : "";
      l.push(
        `- **[${f}]** ${N(p)} trigger=\`${c.trigger ?? "?"}\` | components=[${h.slice(0, 5).join(", ") || "none"}] | localStorage(${S})=${d.length} | sessionStorage(${S})=${g.length}${x}`,
      );
    }));
  let i = t.toRelativeMs(a.capturedAtEpochMs);
  l.push(`
## Selected Snapshot [${r}] (at ${N(i)}, trigger=\`${a.trigger ?? "?"}\`)`);
  let u = ye(a).filter((c) => (o ? H(c).toLowerCase().includes(o) : !0));
  if (u.length > 0) {
    l.push(`
### Component Tree / Chain (${u.length})`);
    for (let c of u) {
      let f = c.componentFile
        ? ` @ ${c.componentFile}${c.componentLine !== void 0 ? `:${c.componentLine}` : ""}`
        : "";
      (l.push(
        `- **${H(c)}** (${c.framework ?? "framework"} v${c.version ?? "?"})${f}`,
      ),
        c.props &&
          Object.keys(c.props).length > 0 &&
          l.push(`  - props: ${JSON.stringify(c.props)}`));
      let p = c.state ?? c.data;
      p &&
        Object.keys(p).length > 0 &&
        l.push(`  - state: ${JSON.stringify(p)}`);
    }
  } else
    l.push(`
### Component Tree
(No component tree recorded on snapshot [${r}])`);
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
  if (a.webStorageDiff) {
    let c = At(a);
    (l.push(`
### Web Storage Diff (delta vs previous state)`),
      c.local &&
        Object.keys(c.local).length > 0 &&
        (l.push("#### localStorage diff"),
        l.push(JSON.stringify(c.local, null, 2))),
      c.session &&
        Object.keys(c.session).length > 0 &&
        (l.push("#### sessionStorage diff"),
        l.push(JSON.stringify(c.session, null, 2))));
  }
  return k(
    l.join(`
`),
    e.maxChars,
  );
}
function It(e, t = 40) {
  if (typeof e != "string") return "";
  let s = e.replace(/\s+/g, " ").trim();
  return s.length <= t ? s : `${s.slice(0, t)}\u2026`;
}
function Ir(e) {
  if (!e) return "";
  if ("targetComponent" in e || "rootComponent" in e) {
    let s = e,
      n = s.targetComponent ?? s.parentChain?.[0] ?? s.rootComponent;
    return n?.componentName ? ` [${n.componentName}]` : "";
  }
  let t = e;
  return t.componentName ? ` [${t.componentName}]` : "";
}
function Rt(e, t = 40) {
  if (!e) return "<unknown>";
  let s = (e.tagName || "element").toLowerCase(),
    n = e.id ? `#${e.id}` : "",
    r = Array.isArray(e.classNames)
      ? e.classNames.filter(Boolean).slice(0, 3)
      : [],
    a = r.length > 0 ? `.${r.join(".")}` : "",
    o = It(e.text ?? e.accessibleName, t),
    l = o ? ` "${o}"` : "",
    i = Ir(e.framework);
  return `<${s}${n}${a}${l}>${i}`;
}
function Se(e, t, s) {
  let n = e.element ?? e.target,
    r = N(s ?? e.elapsedMs),
    a = e.kind ?? "event",
    o = Rt(n),
    l = e.input?.data ?? e.input?.value ?? n?.value ?? n?.attributes?.value,
    i =
      e.input?.key ??
      (typeof e.metadata?.shortcut == "string"
        ? e.metadata.shortcut
        : void 0) ??
      (typeof e.metadata?.key == "string" ? e.metadata.key : void 0),
    u = typeof e.metadata?.toUrl == "string" ? e.metadata.toUrl : void 0,
    c = [];
  (l !== void 0 && l !== "" && c.push(`val="${It(String(l), 50)}"`),
    i && c.push(`key=${i}`),
    u && c.push(`to=${It(u, 80)}`),
    e.screenshot?.dataUrl && c.push(`img=${e.screenshot.dataUrl}`));
  let f = c.length > 0 ? ` ${c.join(" ")}` : "";
  return `[${t}] ${r} [${a}] ${o}${f}`;
}
function On(e) {
  let t = M(e.pack);
  if (t.kind !== "session")
    throw new Error(
      `UNSUPPORTED_PACK_KIND: get_interactions requires a session evidence pack, but "${e.pack}" is a screenshot pack.`,
    );
  let s = t.getInteractions(),
    n =
      e.kinds && e.kinds.length > 0
        ? new Set(e.kinds.map((u) => u.toLowerCase()))
        : void 0,
    r = s
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
          ),
      ),
    a = Math.max(1, e.limit ?? 60),
    o = r.slice(0, a),
    l;
  if (e.format === "json")
    l = k(
      JSON.stringify(
        { totalInteractions: s.length, matchedCount: r.length, items: o },
        null,
        2,
      ),
      e.maxChars,
    );
  else {
    let u = [];
    if (
      (u.push(
        `# Recorded Interactions (showing ${o.length} of ${r.length} matched, total=${s.length})`,
      ),
      o.length === 0)
    )
      u.push("(No interactions matched)");
    else
      for (let { index: c, relativeMs: f, item: p } of o)
        u.push(`- ${Se(p, c, f)}`);
    if (r.length > o.length) {
      let c = (o[o.length - 1]?.index ?? 0) + 1;
      u.push(`
\u2026 ${r.length - o.length} more interactions available. Pass fromIndex=${c} to continue.`);
    }
    l = k(
      u.join(`
`),
      e.maxChars,
    );
  }
  let i = [{ type: "text", text: l }];
  if (e.includeScreenshot)
    for (let { index: u, item: c } of o.slice(0, 3)) {
      let f =
        c.screenshot?.dataUrl && !c.screenshot.dataUrl.startsWith("data:")
          ? c.screenshot.dataUrl
          : void 0;
      f && i.push(...F(t, f, `Interaction [${u}] screenshot`));
    }
  return i;
}
function Me(e) {
  let t = e?.actual?.trim() ?? "",
    s = e?.expected,
    n = e?.note?.trim() || void 0,
    r =
      typeof s == "object" && s !== null && Array.isArray(s.tags)
        ? s.tags.map((i) => String(i).trim()).filter(Boolean)
        : [],
    a = typeof s == "string" ? s.trim() : (s?.text?.trim() ?? ""),
    o =
      typeof s == "object" && s !== null
        ? (s.confidence ?? (a ? "explicit" : "missing"))
        : a
          ? "explicit"
          : "missing";
  !a && n
    ? ((a = n), (o = "note-fallback"))
    : !a && r.length > 0 && o === "missing" && (o = "tag-only");
  let l;
  return (
    o === "tag-only"
      ? (l = `TAG_ONLY_EXPECTATION: User only selected symptom tag(s) [${r.join(", ")}] without stating an explicit expected outcome. Treat any specific expected behavior as a hypothesis.`)
      : (o === "missing" || (!a && r.length === 0)) &&
        (l =
          "UNCAPTURED_EXPECTATION: User expectation was not captured. Any expectation you formulate MUST be explicitly declared as an inferred hypothesis."),
    {
      actual: t,
      expectedText: a,
      confidence: o,
      tags: r,
      ...(n ? { note: n } : {}),
      ...(l ? { confidenceNotice: l } : {}),
    }
  );
}
function Ze(e) {
  let t = e.data.userNarrative ?? e.data.session?.userNarrative;
  if (!t) return;
  let s = t.actual?.trim() || void 0,
    n = t.expected?.trim() || void 0;
  if (!(!s && !n))
    return {
      ...(s ? { actual: s } : {}),
      ...(n ? { expected: n } : {}),
      ...(t.updatedAtEpochMs !== void 0
        ? { updatedAtEpochMs: t.updatedAtEpochMs }
        : {}),
    };
}
function Ln(e) {
  let t = M(e.pack),
    s = e.sceneId ?? (e.sceneIndex !== void 0 ? String(e.sceneIndex) : void 0);
  if (t.kind === "screenshot") {
    let d = t.domContext?.anchors ?? [],
      g = d.map(($) => $.intentFlags?.textComment).filter(Boolean),
      S = Ge(t.domContext),
      x = e.selector ?? s,
      v = [
        {
          type: "text",
          text:
            e.format === "json"
              ? k(
                  JSON.stringify(
                    {
                      kind: "screenshot",
                      smallestCommonAncestorSelector:
                        t.domContext?.smallestCommonAncestorSelector,
                      textComments: g,
                      deviations: S,
                      anchors: x
                        ? d.filter(($, b) =>
                            `${b} ${$.selector ?? ""} ${$.selectorPath ?? ""} ${$.componentName ?? ""} ${$.innerText ?? ""}`
                              .toLowerCase()
                              .includes(x.toLowerCase()),
                          )
                        : d,
                      screenshotPath: t.getScreenshotImagePath(),
                    },
                    null,
                    2,
                  ),
                  e.maxChars,
                )
              : k(
                  [
                    "# Screenshot Scene, DOM Anchors & CSS Cascade",
                    `- **Text Annotations**: ${g.length > 0 ? g.join(" | ") : "(none \u2014 expectation must be treated as inferred hypothesis)"}`,
                    `- **Smallest Common Ancestor**: \`${t.domContext?.smallestCommonAncestorSelector ?? "\u2014"}\``,
                    ...(S.length > 0
                      ? [
                          `
## Auto-Detected Layout/Overflow Deviations (${S.length})`,
                          ...S.map(
                            ($) =>
                              `- \u26A0\uFE0F **[${$.kind}] \`${$.selectorPath ?? $.selector}\`** (anchors: [${$.anchorIndices.slice(0, 6).join(",")}]) \u2014 ${$.summary}${$.keyStyles ? ` | styles=${JSON.stringify($.keyStyles)}` : ""}`,
                          ),
                        ]
                      : []),
                    "",
                    ...Xe(t.domContext, t.cascade, {
                      selector: x,
                      cssProperty: e.cssProperty,
                    }),
                  ].join(`
`),
                  e.maxChars,
                ),
        },
      ],
      w = t.getScreenshotImagePath();
    return (
      (e.includeImage ?? !0) &&
        w &&
        v.push(...F(t, w, "Screenshot pack image")),
      v
    );
  }
  let n = t.getIssueScenes(),
    r = Ze(t);
  if (n.length === 0)
    return e.format === "json"
      ? [
          {
            type: "text",
            text: JSON.stringify(
              { issueScenesCount: 0, ...(r ? { userNarrative: r } : {}) },
              null,
              2,
            ),
          },
        ]
      : r
        ? [
            {
              type: "text",
              text: [
                "No issueScenes were recorded in this evidence pack, but session-level userNarrative was provided:",
                `- **actual**: ${r.actual ?? "(empty)"}`,
                `- **expected**: ${r.expected ?? "(missing \u2014 treat expected behavior as inferred hypothesis)"}`,
              ].join(`
`),
            },
          ]
        : [
            {
              type: "text",
              text: "No issueScenes were recorded in this evidence pack.",
            },
          ];
  let a = s ? n.find((d) => d.id === s || String(d.index) === s) : n[0];
  if (!a) {
    let d = n.map((g) => `${g.index}:${g.id}`).join(", ");
    throw new Error(
      `SCENE_NOT_FOUND: Scene "${s ?? e.sceneId}" not found. Available scenes: [${d}]`,
    );
  }
  let { scene: o } = a,
    l = Me(o.narrative),
    i = l.expectedText,
    u = l.confidence,
    c =
      o.targets && o.targets.length > 0
        ? o.targets
        : o.target
          ? [o.target]
          : [],
    f;
  if (e.format === "json")
    f = k(
      JSON.stringify(
        {
          id: a.id,
          index: a.index,
          relativeMs: t.toRelativeMs(
            o.selectionStartedAtEpochMs ?? o.observedAtEpochMs,
          ),
          narrative: {
            actual: o.narrative?.actual ?? null,
            expected: i || null,
            tags: l.tags,
            note: l.note ?? null,
            confidence: u,
            ...(l.confidenceNotice
              ? { confidenceNotice: l.confidenceNotice }
              : {}),
          },
          sequenceContextNotice:
            "RAW_SAME_TIME_CONTEXT_ONLY: sequenceContext lists events near the mark moment and MUST NOT be treated as a proven causal chain.",
          sequenceContext: o.sequenceContext,
          targets: c,
          annotation: o.annotation,
          originalSource: a.originalSource,
          annotatedSource: a.annotatedSource,
        },
        null,
        2,
      ),
      e.maxChars,
    );
  else {
    let d = [],
      g = t.toRelativeMs(o.selectionStartedAtEpochMs ?? o.observedAtEpochMs);
    (d.push(`# Issue Scene [${a.index}] \`${a.id}\` (at ${N(g)})`),
      d.push(`
## 1. Narrative & Expectation Anchor`),
      d.push(`- **actual**: ${l.actual || "(empty)"}`),
      d.push(`- **expected** [confidence: \`${u}\`]: ${i || "(missing)"}`),
      l.tags.length > 0 && d.push(`- **symptomTags**: [${l.tags.join(", ")}]`),
      l.note && u !== "note-fallback" && d.push(`- **note**: ${l.note}`),
      u === "tag-only"
        ? d.push(
            "  > \u26A0\uFE0F **TAG-ONLY EXPECTATION**: Only symptom tags were selected without a concrete expected outcome; treat any detailed expected behavior as a hypothesis.",
          )
        : (u === "missing" || (!i && l.tags.length === 0)) &&
          d.push(
            "  > \u26A0\uFE0F **UNCAPTURED EXPECTATION**: You MUST explicitly state that the expected behavior was not captured and mark any inferred expectation as a hypothesis.",
          ),
      d.push(`
## 2. Selected DOM Targets (${c.length})`));
    for (let [x, y] of c.entries()) {
      let v = Rt(y.element, 80),
        w = (y.ancestors ?? [])
          .slice(0, 6)
          .map(($) => {
            let b = $.id ? `#${$.id}` : "",
              A =
                $.classNames && $.classNames.length > 0
                  ? `.${$.classNames.slice(0, 2).join(".")}`
                  : "";
            return `${$.tagName ?? "div"}${b}${A}`;
          })
          .join(" <- ");
      (d.push(`- **Target #${x}**: ${v}`),
        w && d.push(`  - **Ancestors**: ${w}`),
        y.sanitizedHtml &&
          d.push(`  - **sanitizedHtml**: \`${y.sanitizedHtml.slice(0, 600)}\``),
        y.computedStyle &&
          Object.keys(y.computedStyle).length > 0 &&
          d.push(`  - **computedStyle**: ${JSON.stringify(y.computedStyle)}`),
        y.state &&
          Object.keys(y.state).length > 0 &&
          d.push(`  - **state**: ${JSON.stringify(y.state)}`),
        y.triggerElement &&
          d.push(
            `  - **triggerElement (Portal Host)**: \`${y.triggerElement.selectorPath ?? y.triggerElement.tagName ?? "?"}\`${y.triggerElement.componentName ? ` (component: \`${y.triggerElement.componentName}\`)` : ""}`,
          ),
        y.relatedOverlays &&
          y.relatedOverlays.length > 0 &&
          d.push(
            `  - **relatedOverlays**: ${y.relatedOverlays.map(($) => `${$.tagName ?? "div"}${$.id ? `#${$.id}` : ""} (${$.relationReason ?? "linked"})`).join(", ")}`,
          ));
    }
    (a.domStylesPath || a.domContextPath) &&
      d.push(`
- **Schema v5 Artifacts**: ${a.domContextPath ? `\`${a.domContextPath}\`` : ""}${a.domStylesPath ? ` \`${a.domStylesPath}\` (inspect winner CSS via \`get_css --scene ${a.index}\`)` : ""}`);
    let S = o.sequenceContext;
    if (
      (d.push(`
## 3. Sequence Context (Raw Same-Time Context \u2014 NOT Proven Causality)`),
      !S)
    )
      d.push("(No sequenceContext recorded)");
    else {
      let x = S.interactions ?? [],
        y = S.consoleErrors ?? [],
        v = S.networkFailures ?? [];
      d.push(
        `Window: ${S.windowMs ?? 6e4}ms before anchor | ${x.length} interactions, ${y.length} console errors, ${v.length} network failures`,
      );
      for (let w of x.slice(-15))
        d.push(
          `  - [${w.offsetMs ?? 0}ms] [${w.kind}] <${w.tagName ?? "?"}> text="${w.text ?? ""}" ${w.value !== void 0 ? `val="${w.value}"` : ""}`,
        );
      for (let w of y)
        d.push(
          `  - [${w.offsetMs ?? 0}ms] [CONSOLE ${w.level ?? "ERROR"}] ${w.text ?? ""}`,
        );
      for (let w of v)
        d.push(
          `  - [${w.offsetMs ?? 0}ms] [NET ${w.method ?? "GET"} ${w.status ?? "ERR"}] ${w.url ?? ""}`,
        );
    }
    f = k(
      d.join(`
`),
      e.maxChars,
    );
  }
  let p = [{ type: "text", text: f }],
    h = e.includeImage ?? !0,
    m = a.annotatedSource ?? a.originalSource;
  return (h && m && p.push(...F(t, m, `Scene [${a.index}] screenshot`)), p);
}
function Fn(e) {
  let t = M(e.pack);
  if (t.kind === "screenshot") {
    let o = t.getScreenshotImagePath();
    if (!o)
      throw new Error(
        `SCREENSHOT_NOT_FOUND: No screenshot image found in screenshot pack "${e.pack}".`,
      );
    return F(t, o, "Screenshot pack image");
  }
  let s = e.final
    ? "final"
    : e.settled
      ? "settled"
      : (e.kind ?? (e.step !== void 0 ? "step" : "issue-annotated"));
  if (s === "final") {
    let o = [];
    t.data.summary?.finalFramePath && o.push(t.data.summary.finalFramePath);
    for (let i of ["jpg", "png", "jpeg", "webp"])
      o.push(`screenshots/final-frame.${i}`);
    for (let i of o)
      if (t.files.has(i)) {
        let u = t.data.summary?.durationMs,
          c = u
            ? `Final frame before stop (+${u}ms)`
            : "Final frame before stop";
        return F(t, i, c);
      }
    let l = Array.from(t.files.keys())
      .filter((i) => i.startsWith("screenshots/"))
      .slice(0, 15)
      .join(", ");
    throw new Error(
      `FINAL_FRAME_NOT_FOUND: Final frame screenshot (screenshots/final-frame.*) was not found in pack. Available screenshots: [${l}]`,
    );
  }
  if (s === "settled") {
    let o = e.step ?? 1,
      l = t.getInteractions()[o - 1],
      i = l?.screenshots?.settledDurationMs ?? l?.screenshot?.settledDurationMs,
      u = [];
    l?.screenshots?.settledPath && u.push(l.screenshots.settledPath);
    for (let f of ["jpg", "png", "jpeg", "webp"])
      u.push(`screenshots/step-${o}-settled.${f}`);
    for (let f of u)
      if (t.files.has(f)) {
        let p = typeof i == "number" ? `, settled in ${i}ms` : "";
        return F(t, f, `Step ${o} settled screenshot${p}`);
      }
    let c = Array.from(t.files.keys())
      .filter((f) => /^screenshots\/step-\d+-settled\./.test(f))
      .slice(0, 15)
      .join(", ");
    throw new Error(
      `SETTLED_SCREENSHOT_NOT_FOUND: Settled screenshot for step ${o} not found. Available settled frames: [${c}]`,
    );
  }
  if (s === "step") {
    let o = e.step ?? 1;
    for (let i of ["jpg", "png", "jpeg", "webp"]) {
      let u = `screenshots/step-${o}.${i}`;
      if (t.files.has(u)) {
        let c = t.data.screenshotSummaries?.find((p) => p.step === o),
          f = c
            ? `Step ${o} screenshot (+${c.elapsedMs ?? 0}ms [${c.kind ?? "?"}] ${c.element ?? ""})`
            : `Step ${o} screenshot`;
        return F(t, u, f);
      }
    }
    let l = Array.from(t.files.keys())
      .filter((i) => i.startsWith("screenshots/step-"))
      .slice(0, 15)
      .join(", ");
    throw new Error(
      `STEP_SCREENSHOT_NOT_FOUND: Screenshot for step ${o} not found. Available sample: [${l}]`,
    );
  }
  let n = t.getIssueScenes();
  if (n.length === 0)
    throw new Error(
      'SCENE_SCREENSHOT_NOT_FOUND: Pack has no issueScenes. Use kind="step" with step=1..N to inspect interaction screenshots.',
    );
  let r = e.sceneId
    ? n.find((o) => o.id === e.sceneId || String(o.index) === e.sceneId)
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
  return F(t, a, `Scene [${r.index}] (${r.id}) ${s}`);
}
import { existsSync as _t } from "node:fs";
import { join as Dn, resolve as et } from "node:path";
import { createHash as Or } from "node:crypto";
var Rr = [
    {
      pattern: /another version of vue devtools seems to be installed/i,
      reason: "vue-devtools-conflict-notice",
    },
    {
      pattern:
        /download the vue devtools extension for a better development experience/i,
      reason: "vue-devtools-download-tip",
    },
    {
      pattern:
        /download the react devtools for a better development experience/i,
      reason: "react-devtools-download-tip",
    },
    {
      pattern: /devtools.*detected.*please enable only one/i,
      reason: "devtools-duplicate-extension-tip",
    },
  ],
  Tr = /^\[bug[-\s]?lens(?:\s[^\]]*)?\]/i,
  _r =
    /(?:hook installed|devtools hook|bridge ready|content script ready|session started|capture ready)/i;
function jn(e) {
  let t = (e.text ?? "").trim();
  if (!t) return { isNoise: !1 };
  for (let { pattern: n, reason: r } of Rr)
    if (n.test(t))
      return { isNoise: !0, category: "devtools-plugin", reason: r };
  let s = (e.level ?? "log").toLowerCase();
  return Tr.test(t) && (s !== "error" || _r.test(t))
    ? {
        isNoise: !0,
        category: "extension-internal",
        reason: "bug-lens-internal-log",
      }
    : { isNoise: !1 };
}
function Lr(e) {
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
function Fr(e) {
  let t = (e.level || "log").toLowerCase().replace("warning", "warn"),
    s = e.sourceMapped ?? e.location ?? "",
    n = Lr(e.text),
    r = `${t}:${s}:${n}`;
  return Or("sha256").update(r).digest("hex").slice(0, 12);
}
function jr(e, t) {
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
function Tt(e) {
  if (typeof e != "number" || !Number.isFinite(e)) return "\u2014";
  let t = Math.round(e);
  return `${t >= 0 ? "+" : "-"}${Math.abs(t)}ms`;
}
function Ye(e, t = {}) {
  let s = e.getConsoleEntries(),
    n =
      t.levels && t.levels.length > 0
        ? new Set(
            t.levels.flatMap((h) => {
              let m = h.toLowerCase();
              return m === "warn" || m === "warning"
                ? ["warn", "warning"]
                : [m];
            }),
          )
        : void 0,
    r = t.search?.toLowerCase(),
    a = t.regex ? new RegExp(t.regex, "i") : void 0,
    o = [],
    l = 0,
    i = new Set();
  s.forEach((h, m) => {
    let d = (h.level ?? "log").toLowerCase();
    if (n && !n.has(d)) return;
    let g = e.toRelativeMs(h.createdAt),
      S = e.toRelativeMs(h.lastCreatedAt) ?? g;
    if (
      (t.fromMs !== void 0 && (S === void 0 || S < t.fromMs)) ||
      (t.toMs !== void 0 && (g === void 0 || g > t.toMs))
    )
      return;
    let x = h.text ?? "",
      y = h.url ?? h.source ?? "",
      v = jr(h.stackTrace, h.stack),
      w = `${x}
${y}
${v ?? ""}`;
    if ((r && !w.toLowerCase().includes(r)) || (a && !a.test(w))) return;
    let $ = y
        ? `${y}${h.lineNumber !== void 0 ? `:${h.lineNumber}` : ""}`
        : void 0,
      b = h.sourceMappedLocation,
      A = b?.originalFunctionName ?? b?.originalName,
      I =
        b?.resolved && b.originalFile
          ? `${b.originalFile}:${b.originalLine ?? 0}${b.originalColumn !== void 0 ? `:${b.originalColumn}` : ""}${A ? ` (${A})` : ""}`
          : void 0,
      U =
        h.summarySignature ??
        Fr({ level: d, location: $, sourceMapped: I, text: x }),
      R = Math.max(1, h.repeatCount ?? 1),
      K = h.isNoise
        ? { isNoise: !0, category: h.noiseCategory ?? "devtools-plugin" }
        : jn({ text: x, level: d, url: h.url, source: h.source });
    if (K.isNoise && !t.includeNoise) {
      ((l += R), i.add(U));
      return;
    }
    o.push({
      entry: h,
      index: m,
      relMs: g,
      lastRelMs: S,
      repeatCount: R,
      level: d,
      text: x,
      loc: $,
      sourceMapped: I,
      stackStr: v,
      signature: U,
      ...(K.isNoise ? { isNoise: !0, noiseCategory: K.category } : {}),
    });
  });
  let u = [],
    c = new Map();
  for (let h of o)
    c.set(h.signature, (c.get(h.signature) ?? 0) + h.repeatCount);
  if (t.unfold) {
    u = [];
    for (let h of o) {
      let m = h.entry.summaryTimestamps;
      if (h.repeatCount > 1 && Array.isArray(m) && m.length > 0)
        for (let d of m) {
          let g = e.toRelativeMs(d) ?? h.relMs ?? 0;
          u.push({
            index: h.index,
            id: h.entry.id,
            relativeMs: g,
            level: h.level,
            text: h.text,
            location: h.loc,
            sourceMapped: h.sourceMapped,
            stack: h.stackStr,
            count: 1,
            firstRelativeMs: g,
            lastRelativeMs: g,
            timeRangeMs: [g, g],
            signature: h.signature,
            ...(h.isNoise
              ? { isNoise: !0, noiseCategory: h.noiseCategory }
              : {}),
          });
        }
      else {
        let d = h.relMs ?? 0,
          g = h.lastRelMs ?? d;
        u.push({
          index: h.index,
          id: h.entry.id,
          relativeMs: h.relMs,
          level: h.level,
          text: h.text,
          location: h.loc,
          sourceMapped: h.sourceMapped,
          stack: h.stackStr,
          count: h.repeatCount,
          firstRelativeMs: d,
          lastRelativeMs: g,
          timeRangeMs: [d, g],
          signature: h.signature,
          ...(h.isNoise ? { isNoise: !0, noiseCategory: h.noiseCategory } : {}),
        });
      }
    }
  } else {
    let h = new Map();
    for (let m of o) {
      let d = m.relMs ?? 0,
        g = m.lastRelMs ?? d,
        S = h.get(m.signature);
      S
        ? ((S.count += m.repeatCount),
          d < S.firstRelativeMs && (S.firstRelativeMs = d),
          g > S.lastRelativeMs && (S.lastRelativeMs = g),
          (S.timeRangeMs = [S.firstRelativeMs, S.lastRelativeMs]),
          !S.stack && m.stackStr && (S.stack = m.stackStr),
          !S.sourceMapped &&
            m.sourceMapped &&
            (S.sourceMapped = m.sourceMapped))
        : h.set(m.signature, {
            index: m.index,
            id: m.entry.id,
            relativeMs: m.relMs,
            level: m.level,
            text: m.text,
            location: m.loc,
            sourceMapped: m.sourceMapped,
            stack: m.stackStr,
            count: m.repeatCount,
            firstRelativeMs: d,
            lastRelativeMs: g,
            timeRangeMs: [d, g],
            signature: m.signature,
            ...(m.isNoise
              ? { isNoise: !0, noiseCategory: m.noiseCategory }
              : {}),
          });
    }
    u = Array.from(h.values());
  }
  if (t.minCount !== void 0 && t.minCount > 1) {
    let h = t.minCount;
    t.unfold
      ? (u = u.filter((m) => (c.get(m.signature ?? "") ?? m.count) >= h))
      : (u = u.filter((m) => m.count >= h));
  }
  let f = Math.max(0, t.offset ?? 0),
    p = Math.max(1, t.limit ?? 50);
  return {
    totalEntries: e.getConsoleTotalCount(),
    matchedCount: u.length,
    hiddenNoiseCount: l,
    hiddenNoiseSignatureCount: i.size,
    folded: !t.unfold,
    offset: f,
    limit: p,
    items: u.slice(f, f + p),
  };
}
function Qe(e, t = {}) {
  let s = (e.level ?? "log").toUpperCase(),
    n = s === "WARNING" ? "WARN" : s,
    r = e.count ?? 1,
    a = e.firstRelativeMs ?? e.relativeMs ?? 0,
    o = e.lastRelativeMs ?? a,
    l = "";
  t.unfold || r <= 1
    ? (l = `[x1 time | ${Tt(a)}]`)
    : (l = `[x${r} times | ${Tt(a)}..${Tt(o)}]`);
  let i = e.isNoise ? ` [NOISE:${e.noiseCategory ?? "plugin"}]` : "",
    c = `[#${String(e.index).padStart(3, "0")}] [${n}]${i} ${l} ${e.text}`,
    f = "       ";
  if (
    (e.sourceMapped
      ? (c += `
${f}sourceMapped: ${e.sourceMapped}`)
      : e.location &&
        (c += `
${f}location: ${e.location}`),
    e.stack)
  ) {
    let p = e.stack
      .split(
        `
`,
      )
      .map((h) => h.trim())
      .filter((h) => h.length > 0)
      .slice(0, 5);
    if (p.length > 0) {
      c += `
${f}stack: ${p[0]}`;
      for (let h = 1; h < p.length; h++)
        c += `
${f}       ${p[h]}`;
    }
  }
  return c;
}
function Dr(e, t, s) {
  let n = e.data.summary,
    r = e.getIssueScenes(),
    a = Ze(e),
    o = Ye(e, { levels: ["error"], limit: 5 }),
    l = Ne(e, { status: "failed", limit: 5 }),
    i = Ne(e, { status: "all", limit: 1 }),
    u = e.listFiles(),
    c = q(e),
    f = c && _t(Dn(c, Y)) ? et(c, Y) : void 0,
    p = c
      ? ze.map((y) => et(c, ...y.target.split("/"))).filter((y) => _t(y))
      : [],
    h = c
      ? Array.from(e.skippedMediaFiles.keys()).map((y) =>
          et(c, ...y.split("/")),
        )
      : [];
  if (t === "json") {
    let y = {
      kind: "session",
      packPath: e.packPath,
      workspaceDir: c,
      indexPath: f,
      derivedJsonFiles: p,
      recordingPaths: h,
      sessionId: e.sessionId,
      packMode: e.manifest?.packMode,
      casStats: e.manifest?.casStats,
      integrity: e.integrity,
      summary: n,
      ...(a ? { userNarrative: a } : {}),
      issueScenes: r.map((v) => {
        let w = Me(v.scene.narrative);
        return {
          id: v.id,
          index: v.index,
          actual: w.actual || null,
          expected: w.expectedText || null,
          expectedConfidence: w.confidence,
          ...(w.tags.length > 0 ? { symptomTags: w.tags } : {}),
          ...(w.note ? { note: w.note } : {}),
          originalSource: v.originalSource,
          annotatedSource: v.annotatedSource,
        };
      }),
      topConsoleErrors: o.items,
      hiddenConsoleNoiseCount: o.hiddenNoiseCount,
      staticNoBodyNetworkCount: i.staticNoBodyCount,
      topNetworkFailures: l.items,
      filesCount: u.length,
      files: u,
    };
    return k(JSON.stringify(y, null, 2), s);
  }
  let m = [];
  if (
    (e.integrity.schemaWarning &&
      m.push(`\u26A0\uFE0F ${e.integrity.schemaWarning}
`),
    e.integrity.valid ||
      m.push(`\u26A0\uFE0F Integrity check reported mismatches: ${e.integrity.mismatches.join("; ")}
`),
    m.push("# Bug Lens Evidence Pack (kind: session)"),
    c && m.push(`- **Workspace**: \`${c}\``),
    f &&
      m.push(
        `- **Index**: \`${f}\` (read this file for full schema, request->body map, and jq recipes)`,
      ),
    p.length > 0 &&
      m.push(`- **Derived JSON**: ${p.map((y) => `\`${y}\``).join(", ")}`),
    h.length > 0 &&
      m.push(`- **Recording**: ${h.map((y) => `\`${y}\``).join(", ")}`),
    m.push(`- **Session ID**: \`${e.sessionId}\``),
    m.push(
      `- **Schema**: v${e.integrity.schemaVersion ?? e.data.session?.schemaVersion ?? "?"} (integrity: ${e.integrity.valid ? "OK" : "MISMATCH"}, checked ${e.integrity.checkedCount} files)`,
    ),
    m.push(
      `- **Page**: ${n?.title ?? e.data.session?.target?.initialTitle ?? "\u2014"} (${n?.url ?? e.data.session?.target?.initialUrl ?? "\u2014"})`,
    ),
    m.push(
      `- **Duration**: ${re(n?.durationMs ?? e.data.session?.timeline?.durationMs)} | Quality: ${n?.quality ?? "\u2014"} | Privacy: ${n?.privacyMode ?? "\u2014"}`,
    ),
    n?.environment)
  ) {
    let y = n.environment;
    m.push(
      `- **Environment**: ${y.os ?? "?"} \xB7 ${y.browser ?? "?"} \xB7 ${y.language ?? "?"} \xB7 screen ${y.screen ?? "?"} \xB7 viewport ${y.viewport ?? "?"}`,
    );
  }
  if (
    (m.push(
      `- **Counts**: ${e.getInteractions().length} interactions | ${e.getConsoleTotalCount()} console entries (${o.matchedCount} unique error signatures${o.hiddenNoiseCount > 0 ? `, ${o.hiddenNoiseCount} benign noise hidden` : ""}) | ${e.getNetworkEntries().length} network requests (${l.matchedCount} failed${i.staticNoBodyCount > 0 ? `, ${i.staticNoBodyCount} benign 0B static` : ""}) | ${r.length} issue scenes | ${e.getFrameworkStates().length} framework snapshots`,
    ),
    a &&
      (m.push(`
## Session User Narrative`),
      a.actual && m.push(`- **actual**: ${a.actual}`),
      a.expected &&
        m.push(`- **expected** [confidence=explicit]: ${a.expected}`)),
    m.push(`
## Issue Scenes (${r.length})`),
    r.length === 0)
  )
    m.push("(No issue scenes marked in this session)");
  else
    for (let y of r) {
      let v = e.toRelativeMs(
          y.scene.selectionStartedAtEpochMs ?? y.scene.observedAtEpochMs,
        ),
        w = Me(y.scene.narrative);
      (m.push(`- **Scene [${y.index}] \`${y.id}\`** (at ${N(v)}):`),
        m.push(`  - **actual**: ${w.actual || "(empty)"}`),
        m.push(
          `  - **expected** [confidence=${w.confidence}]: ${w.expectedText || (w.tags.length > 0 ? `(symptom tags only: [${w.tags.join(", ")}] \u2014 expected behavior not stated)` : "(not captured \u2014 treat any expectation as inferred hypothesis)")}`,
        ),
        w.note &&
          w.confidence !== "note-fallback" &&
          m.push(`  - **note**: ${w.note}`),
        m.push(
          `  - **screenshots**: annotated=\`${y.annotatedSource ?? "none"}\`, original=\`${y.originalSource ?? "none"}\``,
        ));
      let $ = y.annotatedSource ?? y.originalSource;
      if ($) {
        let b = qe(e, $);
        b &&
          m.push(
            `  - **savedImagePath**: \`${b}\` (call \`read_file\` on this path to view the scene screenshot)`,
          );
      }
    }
  if (
    (m.push(`
## Top Console Errors (${o.matchedCount} total)`),
    o.items.length === 0)
  )
    m.push(
      o.hiddenNoiseCount > 0
        ? `(No application console errors recorded; ${o.hiddenNoiseCount} benign devtools/extension noise entries hidden \u2014 pass \`query_console --includeNoise\` to inspect)`
        : "(No console errors recorded)",
    );
  else {
    for (let y of o.items) m.push(`- ${Qe(y)}`);
    o.hiddenNoiseCount > 0 &&
      m.push(
        `- _(${o.hiddenNoiseCount} benign devtools/extension noise entries hidden; pass \`query_console --includeNoise\` to inspect)_`,
      );
  }
  if (
    (m.push(`
## Top Failed Network Requests (${l.matchedCount} total)`),
    l.items.length === 0)
  )
    m.push("(No failed network requests recorded)");
  else for (let y of l.items) m.push(`- ${We(y)}`);
  m.push(`
## Package Files (${u.length})`);
  let d = u.filter(
      (y) =>
        !y.path.startsWith("screenshots/") &&
        !y.path.startsWith("network/body-"),
    ),
    g = u.filter((y) => y.path.startsWith("network/body-")).length,
    S = u.filter((y) => y.path.startsWith("screenshots/")).length;
  for (let y of d)
    m.push(
      `- \`${y.path}\` (${y.byteLength} B${y.skippedMedia ? ", extracted on disk" : ""})`,
    );
  (g > 0 && m.push(`- \`network/body-*.txt\` (${g} split body files)`),
    S > 0 && m.push(`- \`screenshots/step-*.*\` (${S} step screenshots)`));
  let x = e.files.has("session-data.json")
    ? "session-data.json"
    : "data/session-data.json";
  return (
    m.push(`
**Next steps** (active pack is extracted & cached; omit \`--pack\` in subsequent commands): Run \`get_scene\` to inspect DOM targets & annotated screenshot, \`timeline --windowMs 15000\` for chronological events around the issue, \`query_network --status failed\` / \`get_request <id> --jsonPath "..."\` for API bodies, \`get_framework_state\` for Vue/React state, or read \`INDEX.md\` and query \`${x}\` / \`network/*\` directly with \`jq\`.`),
    k(
      m.join(`
`),
      s,
    )
  );
}
function Br(e, t, s) {
  let n = e.domContext,
    r = n?.anchors ?? [],
    a = e.listFiles(),
    o = q(e),
    l = o && _t(Dn(o, Y)) ? et(o, Y) : void 0;
  if (t === "json")
    return k(
      JSON.stringify(
        {
          kind: "screenshot",
          packPath: e.packPath,
          workspaceDir: o,
          indexPath: l,
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
  let i = [],
    u = e.environment,
    c = u?.recentConsoleErrors ?? [],
    f = u?.recentFailedRequests ?? [],
    p = u?.frameworkComponentStates ?? u?.vueComponentStates ?? [],
    h = e.getScreenshotImagePath(),
    m = h ? qe(e, h) : void 0;
  if (
    (i.push("# Bug Lens Screenshot Pack (kind: screenshot)"),
    o && i.push(`- **Workspace**: \`${o}\``),
    l && i.push(`- **Index**: \`${l}\``),
    i.push(
      `- **Image**: \`${h ?? "none"}\`${m ? ` -> Saved to \`${m}\` (call \`read_file\` on this path to inspect visually)` : ""}`,
    ),
    u &&
      (i.push(`- **Page**: ${u.title ?? "\u2014"} (${u.url ?? "\u2014"})`),
      i.push(
        `- **Viewport**: ${u.viewport?.width ?? "?"}x${u.viewport?.height ?? "?"} (${u.mediaBreakpoint ?? "?"}) | UA: ${u.userAgent ?? "\u2014"}`,
      ),
      i.push(
        `- **Anomalies & State**: ${c.length} recent console error(s) | ${f.length} failed request(s) | ${p.length} component state snapshot(s)`,
      )),
    n)
  ) {
    i.push(
      `- **DOM Context**: SCA=\`${n.smallestCommonAncestorSelector ?? "?"}\` | anchors=${n.meta?.anchorCount ?? r.length}, leaves=${n.meta?.leafCount ?? n.leaves?.length ?? 0}, ancestors=${n.meta?.ancestorCount ?? n.ancestors?.length ?? 0}`,
    );
    let d = Ge(n);
    if (d.length > 0) {
      i.push(`
## Layout & Overflow Diagnostics (${d.length} distinct issue group(s))`);
      for (let x of d) {
        let y =
            x.anchorIndices.length > 0
              ? ` (anchors: [${x.anchorIndices.slice(0, 6).join(", ")}${x.anchorIndices.length > 6 ? `, ... (${x.anchorIndices.length} total)` : ""}])`
              : "",
          v = x.component ? ` [${x.component}]` : "";
        (i.push(
          `- \u26A0\uFE0F **[${x.kind}] \`${x.selectorPath ?? x.selector}\`**${v}${y}: ${x.summary}`,
        ),
          x.sampleText && i.push(`  - sampleText: "${x.sampleText}"`),
          x.keyStyles &&
            i.push(`  - keyComputedStyles: ${JSON.stringify(x.keyStyles)}`));
      }
    }
    i.push(`
## Annotated DOM Anchors (${r.length})`);
    let g = new Map(),
      S = [];
    r.forEach((x, y) => {
      let v = `${x.selectorPath ?? x.selector ?? "?"}|${x.componentName ?? ""}|${JSON.stringify(x.intentFlags ?? {})}`,
        w = g.get(v);
      w ? w.push(y) : (g.set(v, [y]), S.push({ idx: y, anchor: x, sig: v }));
    });
    for (let { idx: x, anchor: y, sig: v } of S.slice(0, 15)) {
      let w = g.get(v) ?? [x],
        $ =
          w.length > 1
            ? ` (+${w.length - 1} siblings: [${w.slice(1, 5).join(",")}${w.length > 5 ? ",..." : ""}])`
            : "",
        b = [];
      (y.intentFlags?.isArrowTarget && b.push("arrow"),
        y.intentFlags?.isHighlightedFocus && b.push("focus"),
        y.intentFlags?.textComment &&
          b.push(`comment="${y.intentFlags.textComment}"`));
      let A = b.length > 0 ? ` [${b.join(",")}]` : "",
        I = y.componentName
          ? ` [${y.componentName}${y.componentFile ? ` @ ${y.componentFile}${y.componentLine ? `:${y.componentLine}` : ""}` : ""}]`
          : "",
        U = y.selectorPath ?? y.selector ?? "?",
        R = U.length > 75 ? `\u2026${U.slice(-72)}` : U,
        K = (y.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 50);
      i.push(`- [${x}] \`${R}\`${I}${A}${$}${K ? ` text="${K}"` : ""}`);
    }
    S.length > 15 &&
      i.push(
        `- ... +${S.length - 15} more unique anchors (use \`get_scene(selector="...")\` to filter)`,
      );
  }
  if ((e.cascade && i.push(...Pn(e.cascade)), c.length > 0)) {
    i.push(`
## Recent Console Errors (${c.length})`);
    for (let [d, g] of c.slice(0, 5).entries())
      i.push(`- [#${d}] ${g.message ?? ""}`);
  }
  if (f.length > 0) {
    i.push(`
## Recent Failed Network Requests (${f.length})`);
    for (let d of f.slice(0, 5))
      i.push(`- ${d.method ?? "GET"} ${d.status ?? 0} ${d.url ?? ""}`);
  }
  i.push(`
## Files (${a.length})`);
  for (let d of a) i.push(`- \`${d.path}\` (${d.byteLength} B)`);
  return (
    i.push(
      '\n**Next steps** (active pack is cached; omit `--pack` in subsequent commands): Call `read_file` on the saved image path above to inspect `screenshot.jpg`; run `get_scene --selector "..." --cssProperty "..."` to inspect anchor `computedStyles`/`layoutContext` and matched CSS cascade rules; run `search_pack "<keyword>"` to search across `cascade.json` & `dom-context.json`; run `get_framework_state` for component props/data; or check `INDEX.md` and query `dom-context.json` / `cascade.json` / `environment.json` in the workspace directly with `jq`.',
    ),
    k(
      i.join(`
`),
      s,
    )
  );
}
function Bn(e) {
  let t = M(e.pack),
    s = e.format ?? "text";
  return t.kind === "session" ? Dr(t, s, e.maxChars) : Br(t, s, e.maxChars);
}
function zn(e) {
  let t = M(e.pack);
  if (t.kind === "screenshot") {
    let a = t.environment?.recentConsoleErrors ?? [],
      o = e.search?.toLowerCase(),
      l = e.regex ? new RegExp(e.regex, "i") : void 0,
      i = a.filter((c) => {
        let f = `${c.message ?? ""}
${c.stack ?? ""}`;
        return !((o && !f.toLowerCase().includes(o)) || (l && !l.test(f)));
      });
    if (e.format === "json")
      return k(
        JSON.stringify(
          { totalEntries: a.length, matchedCount: i.length, items: i },
          null,
          2,
        ),
        e.maxChars,
      );
    let u = [
      `# Screenshot Pack Console Errors (${i.length} of ${a.length})`,
      ...i.map(
        (c, f) =>
          `[#${f}] [ERROR] ${c.message ?? ""}${
            c.stack
              ? `
    ${c.stack
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
    return k(
      u.join(`
`),
      e.maxChars,
    );
  }
  let s = Ye(t, {
    levels: e.levels,
    search: e.search,
    regex: e.regex,
    fromMs: e.fromMs,
    toMs: e.toMs,
    offset: e.offset,
    limit: e.limit,
    unfold: e.unfold,
    minCount: e.minCount,
    includeNoise: e.includeNoise,
  });
  if (e.format === "json") return k(JSON.stringify(s, null, 2), e.maxChars);
  let n = [];
  if (
    (n.push(
      `# Console Logs (${s.folded ? "folded" : "unfolded"}, matched ${s.matchedCount} of ${s.totalEntries} total, showing offset=${s.offset}..${s.offset + s.items.length})`,
    ),
    s.items.length === 0)
  )
    n.push("(No console entries matched the given filters)");
  else for (let a of s.items) n.push(Qe(a, { unfold: e.unfold }));
  s.hiddenNoiseCount > 0 &&
    n.push(`
Note: ${s.hiddenNoiseCount} benign devtools/extension noise entries (${s.hiddenNoiseSignatureCount} unique signatures) hidden by default. Pass \`--includeNoise\` to inspect.`);
  let r = s.matchedCount - (s.offset + s.items.length);
  return (
    r > 0 &&
      n.push(`
\u2026 ${r} more entries available. Use offset=${s.offset + s.items.length} to continue.`),
    k(
      n.join(`
`),
      e.maxChars,
    )
  );
}
function qn(e) {
  let t = M(e.pack);
  if (t.kind === "screenshot") {
    let a = t.environment?.recentFailedRequests ?? [],
      o = e.urlContains?.toLowerCase(),
      l = e.method?.toUpperCase(),
      i = a.filter(
        (c) =>
          !(
            (o && !(c.url ?? "").toLowerCase().includes(o)) ||
            (l && (c.method ?? "GET").toUpperCase() !== l)
          ),
      );
    if (e.format === "json")
      return k(
        JSON.stringify(
          { totalEntries: a.length, matchedCount: i.length, items: i },
          null,
          2,
        ),
        e.maxChars,
      );
    let u = [
      `# Screenshot Pack Failed Network Requests (${i.length} of ${a.length})`,
      ...i.map(
        (c, f) =>
          `- [#${f}] ${c.method ?? "GET"} !${c.status ?? 0} ${c.statusText ?? ""} | ${c.url ?? ""}`,
      ),
    ];
    return k(
      u.join(`
`),
      e.maxChars,
    );
  }
  let s = Ne(t, {
    status: e.status,
    bizError: e.bizError,
    bizCode: e.bizCode,
    urlContains: e.urlContains,
    method: e.method,
    type: e.type,
    apiOnly: e.apiOnly,
    offset: e.offset,
    limit: e.limit,
  });
  if (e.format === "json") return k(JSON.stringify(s, null, 2), e.maxChars);
  let n = [];
  if (
    (n.push(
      `# Network Requests (matched ${s.matchedCount} of ${s.totalEntries} total, showing offset=${s.offset}..${s.offset + s.items.length})`,
    ),
    s.items.length === 0)
  )
    n.push("(No network requests matched the given filters)");
  else for (let a of s.items) n.push(`- ${We(a)}`);
  s.hiddenStaticCount > 0
    ? n.push(`
Note: ${s.hiddenStaticCount} benign static asset entries excluded by \`--apiOnly\`.`)
    : s.staticNoBodyCount > 0 &&
      n.push(`
Note: ${s.staticNoBodyCount} benign 0B/cached static entries deprioritized to the end. Pass \`--apiOnly\` to exclude static assets.`);
  let r = s.matchedCount - (s.offset + s.items.length);
  return (
    r > 0 &&
      n.push(`
\u2026 ${r} more requests available. Use offset=${s.offset + s.items.length} to continue, or call get_request(id) to inspect a specific request.`),
    k(
      n.join(`
`),
      e.maxChars,
    )
  );
}
import { existsSync as zr, readFileSync as qr } from "node:fs";
import { resolve as Un, sep as Jr } from "node:path";
function Ur(e, t) {
  if (!e) return;
  let s = Un(e),
    n = Un(s, ...t.split("/"));
  if (!(!n.startsWith(s + Jr) || !zr(n))) return qr(n, "utf8");
}
function Wn(e) {
  let t = M(e.pack),
    s = e.path.replace(/^\.?\//, ""),
    n = t.getTextFile(s) ?? Ur(q(t), s);
  if (n === void 0) {
    let i = t
      .listFiles()
      .map((u) => u.path)
      .slice(0, 30)
      .join(", ");
    throw new Error(
      `FILE_NOT_FOUND_IN_PACK: "${s}" does not exist in pack. Available files sample: [${i}]`,
    );
  }
  if (e.jsonPath) {
    let i;
    if (s.endsWith(".js")) i = oe(n, s);
    else
      try {
        i = JSON.parse(n);
      } catch (c) {
        let f = c instanceof Error ? c.message : String(c);
        throw new Error(
          `INVALID_JSON_FILE: Cannot apply jsonPath "${e.jsonPath}" to "${s}": ${f}`,
        );
      }
    let u = Q(i, e.jsonPath);
    return k(JSON.stringify(u, null, 2), e.maxChars ?? 24e3);
  }
  let r = Math.max(0, e.offset ?? 0),
    a = e.maxChars ?? 24e3,
    o = n.slice(r),
    l = r + a;
  return k(
    o,
    a,
    n.length > l
      ? `Use offset=${l} to read the next chunk (total ${n.length} chars).`
      : void 0,
  );
}
function Ot(e, t, s = 180, n = 3) {
  let r = t.includes("svg")
      ? e
      : e.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "<svg/>"),
    a = r.toLowerCase(),
    o = [],
    l = 0;
  for (; l < a.length && o.length < n;) {
    let i = a.indexOf(t, l);
    if (i < 0) break;
    let u = Math.max(0, i - s),
      c = Math.min(r.length, i + t.length + s),
      f = o[o.length - 1];
    (f && u <= f.end
      ? (f.end = Math.max(f.end, c))
      : o.push({ start: u, end: c }),
      (l = i + Math.max(1, t.length)));
  }
  return o.length === 0
    ? [
        r
          .slice(0, s * 2)
          .replace(/\s+/g, " ")
          .trim(),
      ]
    : o.map(({ start: i, end: u }) => {
        let c = i > 0 ? "\u2026" : "",
          f = u < r.length ? "\u2026" : "";
        return c + r.slice(i, u).replace(/\s+/g, " ").trim() + f;
      });
}
function Hn(e, t) {
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
    o = Math.min(2e3, Math.max(40, t.contextChars ?? 180)),
    l = [];
  if (
    (r.has("console") &&
      e.getConsoleEntries().forEach((i, u) => {
        let c = `${i.text ?? ""} ${i.url ?? ""} ${i.stackTrace ?? i.stack ?? ""}`;
        if (c.toLowerCase().includes(n)) {
          let f = e.toRelativeMs(i.createdAt),
            [p] = Ot(c, n, o, 1);
          l.push({
            scope: "console",
            ref: `console#${u}`,
            relativeMs: f,
            snippet: `${N(f)} [${i.level ?? "log"}] ${p}`,
          });
        }
      }),
    r.has("network-url"))
  ) {
    for (let i of e.getNetworkEntries())
      if (i.url.toLowerCase().includes(n)) {
        let u = e.toRelativeMs(i.createdAt);
        l.push({
          scope: "network-url",
          ref: i.id,
          relativeMs: u,
          snippet: `${N(u)} ${i.method ?? "GET"} ${i.status ?? 0} ${i.url}`,
        });
      }
  }
  if (r.has("network-body"))
    for (let i of e.getNetworkEntries()) {
      let u = e.getNetworkBody(i);
      if (u && u.toLowerCase().includes(n)) {
        let c = e.toRelativeMs(i.createdAt),
          f = Ot(u, n, o, 3);
        for (let p of f)
          l.push({
            scope: "network-body",
            ref: i.id,
            relativeMs: c,
            snippet: `${N(c)} (${i.url}) ${p}`,
          });
      }
    }
  return (
    r.has("interactions") &&
      e.getInteractions().forEach((i, u) => {
        let c = Se(i, u, e.toRelativeMs(i.createdAt)),
          f = JSON.stringify(i.element ?? i.target ?? {});
        (c.toLowerCase().includes(n) || f.toLowerCase().includes(n)) &&
          l.push({
            scope: "interactions",
            ref: `interaction#${u}`,
            relativeMs: e.toRelativeMs(i.createdAt),
            snippet: c,
          });
      }),
    r.has("framework") &&
      e.getFrameworkStates().forEach((i, u) => {
        let c = JSON.stringify(i);
        if (c.toLowerCase().includes(n)) {
          let f = e.toRelativeMs(i.capturedAtEpochMs),
            p = Ot(c, n, o, 2);
          for (let h of p)
            l.push({
              scope: "framework",
              ref: `frameworkState#${u}`,
              relativeMs: f,
              snippet: `${N(f)} [trigger=${i.trigger ?? "?"}] ${h}`,
            });
        }
      }),
    { query: s, totalHits: l.length, hits: l.slice(0, a) }
  );
}
function Wr(e, t, s = 30, n = 180) {
  let r = t.trim().toLowerCase();
  if (!r) return { totalHits: 0, hits: [] };
  let a = [];
  if (
    ((e.domContext?.anchors ?? []).forEach((i, u) => {
      if (
        JSON.stringify({
          selector: i.selector,
          selectorPath: i.selectorPath,
          componentName: i.componentName,
          componentFile: i.componentFile,
          innerText: i.innerText,
          computedStyles: i.computedStyles,
          layoutContext: i.layoutContext,
          intentFlags: i.intentFlags,
        })
          .toLowerCase()
          .includes(r)
      ) {
        let f = i.componentName
            ? ` [${i.componentName}${i.componentFile ? ` @ ${i.componentFile}:${i.componentLine ?? ""}` : ""}]`
            : "",
          p = i.layoutContext?.textOverflow?.reason;
        a.push({
          category: "dom-anchor",
          ref: `anchor#${u}`,
          detail: `\`${i.selectorPath ?? i.selector ?? "?"}\`${f} text="${(i.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 80)}"${p ? ` | overflow: ${p}` : ""} | styles=${JSON.stringify(i.computedStyles ?? {})}`,
        });
      }
    }),
    e.cascade)
  ) {
    let i = e.cascade.sheets ?? [],
      u = e.cascade.rules ?? [],
      c = e.cascade.elements ?? [],
      f = new Map();
    for (let d of i) f.set(d.id, d);
    let p = new Map();
    for (let d of u) p.set(d.id, d);
    let h = new Map();
    for (let d of c) {
      let g = `${d.id}(${d.selector})`;
      for (let S of d.matchedRuleIds ?? []) {
        let x = h.get(S);
        x ? x.push(g) : h.set(S, [g]);
      }
    }
    for (let d of i)
      (d.id.toLowerCase() === r ||
        (d.href && d.href.toLowerCase().includes(r))) &&
        a.push({
          category: "cascade-sheet",
          ref: d.id,
          detail: `href=${d.href ?? "inline"} (${d.rulesCount ?? 0} rules, tag=<${d.ownerNodeTag ?? "style"}>)`,
        });
    for (let [d, g] of c.entries())
      if (g.id.toLowerCase() === r || g.selector.toLowerCase().includes(r)) {
        let S = (g.matchedRuleIds ?? [])
          .slice(-6)
          .map((x) => {
            let y = p.get(x);
            return y ? `${x}:${y.selectorText}` : x;
          })
          .join(", ");
        a.push({
          category: "cascade-element",
          ref: `${g.id} (index ${d})`,
          detail: `<${g.tagName}> \`${g.selector}\` (${(g.matchedRuleIds ?? []).length} matched rules, e.g. [${S}])`,
        });
      }
    let m = new Map();
    for (let d of u)
      if (
        d.id.toLowerCase() === r ||
        d.selectorText.toLowerCase().includes(r) ||
        d.cssText.toLowerCase().includes(r)
      ) {
        let g = `${d.selectorText}||${d.cssText}`,
          S = f.get(d.sheetId),
          x = S?.href ? `${d.sheetId} (${S.href})` : `${d.sheetId} (inline)`,
          y = h.get(d.id) ?? [],
          v = m.get(g);
        if (v) {
          (v.ruleIds.push(d.id), v.sheetRefs.add(x));
          for (let w of y) v.matchedElements.add(w);
        } else
          m.set(g, {
            rule: d,
            ruleIds: [d.id],
            sheetRefs: new Set([x]),
            matchedElements: new Set(y),
          });
      }
    for (let d of m.values()) {
      let g =
          d.ruleIds.length > 3
            ? `${d.ruleIds.slice(0, 3).join(", ")} (+${d.ruleIds.length - 3})`
            : d.ruleIds.join(", "),
        S = Array.from(d.sheetRefs).slice(0, 2).join(" | "),
        x = Array.from(d.matchedElements),
        y =
          x.length > 0
            ? ` | matchedElements: [${x.slice(0, 5).join(", ")}${x.length > 5 ? ", ..." : ""}]`
            : "";
      a.push({
        category: "cascade-rule",
        ref: g,
        detail: `[sheet: ${S}] \`${d.rule.selectorText}\` -> \`${d.rule.cssText}\`${y}`,
      });
    }
  }
  if (
    ((
      e.environment?.frameworkComponentStates ??
      e.environment?.vueComponentStates ??
      []
    ).forEach((i, u) => {
      JSON.stringify(i).toLowerCase().includes(r) &&
        a.push({
          category: "component-state",
          ref: `${i.componentName ?? "Component"}#${u}`,
          detail: `${i.componentFile ? `@ ${i.componentFile}:${i.componentLine ?? ""} ` : ""}props=${JSON.stringify(i.props ?? {})} data=${JSON.stringify(i.data ?? i.state ?? {})}`,
        });
    }),
    a.length === 0)
  ) {
    for (let i of e.listFiles())
      if (i.path.endsWith(".json") || i.path.endsWith(".md")) {
        let u = e.getTextFile(i.path) ?? "",
          c = u.toLowerCase().indexOf(r);
        if (c >= 0) {
          let f = Math.max(0, c - n),
            p = Math.min(u.length, c + r.length + n);
          a.push({
            category: "file",
            ref: i.path,
            detail: u.slice(f, p).replace(/\s+/g, " ").trim(),
          });
        }
      }
  }
  return { totalHits: a.length, hits: a.slice(0, s) };
}
function Kn(e) {
  let t = M(e.pack),
    s = Math.min(2e3, Math.max(40, e.contextChars ?? 180));
  if (t.kind === "screenshot") {
    let a = Wr(t, e.query, e.limit ?? 30, s);
    if (e.format === "json")
      return k(
        JSON.stringify(
          { query: e.query, totalHits: a.totalHits, hits: a.hits },
          null,
          2,
        ),
        e.maxChars,
      );
    let o = [
      `# Search Results in Screenshot Pack for "${e.query}" (showing ${a.hits.length} of ${a.totalHits} total hits)`,
      ...(a.hits.length === 0
        ? [
            "(No matches found in dom-context.json, cascade.json, or environment.json)",
          ]
        : a.hits.map(
            (l) => `- **[${l.category}]** \`${l.ref}\` \u2014 ${l.detail}`,
          )),
    ];
    return k(
      o.join(`
`),
      e.maxChars,
    );
  }
  let n = Hn(t, {
    query: e.query,
    scopes: e.scopes,
    limit: e.limit,
    contextChars: e.contextChars,
  });
  if (e.format === "json") return k(JSON.stringify(n, null, 2), e.maxChars);
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
  return k(
    r.join(`
`),
    e.maxChars,
  );
}
function Gn(e, t = {}) {
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
    let u = e.getIssueScenes(),
      c = t.aroundSceneId
        ? (u.find(
            (f) =>
              f.id === t.aroundSceneId || String(f.index) === t.aroundSceneId,
          ) ?? u[0])
        : u[0];
    if (c) {
      let f =
          c.scene.selectionStartedAtEpochMs ??
          c.scene.observedAtEpochMs ??
          c.scene.sequenceContext?.anchorEpochMs,
        p = e.toRelativeMs(f);
      if (p !== void 0) {
        let h = t.windowMs ?? 15e3;
        ((n = p - h),
          (r = p + Math.min(5e3, Math.floor(h / 3))),
          (a = `Around scene "${c.id}" (${N(n)} .. ${N(r)})`));
      }
    }
  } else
    (n !== void 0 || r !== void 0) &&
      (a = `Range ${N(n ?? 0)} .. ${N(r ?? 1 / 0)}`);
  let o = [];
  if (
    (s.has("interaction") &&
      e.getInteractions().forEach((c, f) => {
        let p = e.toRelativeMs(c.createdAt) ?? c.elapsedMs ?? 0,
          h = c.createdAt ?? e.toEpochMs(p);
        o.push({
          kind: "interaction",
          epochMs: h,
          relativeMs: p,
          refId: f,
          summary: Se(c, f, p),
        });
      }),
    s.has("console") &&
      e.getConsoleEntries().forEach((c, f) => {
        let p = (c.level ?? "log").toLowerCase();
        if (
          !t.includeAllConsole &&
          p !== "error" &&
          p !== "warning" &&
          p !== "warn"
        )
          return;
        let h = e.toRelativeMs(c.createdAt) ?? 0,
          m = c.createdAt ?? e.toEpochMs(h),
          d = (c.text ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
        o.push({
          kind: "console",
          epochMs: m,
          relativeMs: h,
          refId: c.id ?? f,
          summary: `${N(h)} [console.${p}] ${d}`,
        });
      }),
    s.has("network") &&
      e.getNetworkEntries().forEach((c) => {
        let f = e.toRelativeMs(c.createdAt) ?? 0;
        if ((n !== void 0 && f < n) || (r !== void 0 && f > r)) return;
        let p = c.status ?? 0,
          h = (c.type ?? "").toLowerCase(),
          m = h === "xhr" || h === "fetch" || h === "document",
          d = Ue(c),
          g = Nt(e, c, {
            allowBodyScan: !d && (!h || h === "xhr" || h === "fetch"),
            maxScanBytes: 256 * 1024,
          }),
          S = d || g.isBizError;
        if (!t.includeAllNetwork && !S && !m) return;
        let x = c.createdAt ?? e.toEpochMs(f),
          y = c.method ?? "GET",
          v = re(c.durationMs),
          w = g.isBizError ? Mt(p, g) : d ? `!${p || "ERR"}` : String(p);
        o.push({
          kind: "network",
          epochMs: x,
          relativeMs: f,
          refId: c.id,
          summary: `${N(f)} [net ${y} ${w} ${v}] ${c.url} (id=${c.id})`,
        });
      }),
    s.has("scene"))
  )
    for (let u of e.getIssueScenes()) {
      let c = u.scene.selectionStartedAtEpochMs ?? u.scene.observedAtEpochMs,
        f = e.toRelativeMs(c) ?? 0,
        p = u.scene.narrative?.actual ?? "(no narrative)";
      o.push({
        kind: "scene",
        epochMs: c ?? e.toEpochMs(f),
        relativeMs: f,
        refId: u.id,
        summary: `${N(f)} [ISSUE SCENE ${u.id}] actual="${p}"`,
      });
    }
  let l = o
      .filter(
        (u) =>
          !(
            (n !== void 0 && u.relativeMs < n) ||
            (r !== void 0 && u.relativeMs > r)
          ),
      )
      .sort((u, c) => u.relativeMs - c.relativeMs),
    i = t.limit ?? 80;
  return {
    windowDescription: a,
    totalMatched: l.length,
    events: l.slice(0, i),
  };
}
function Xn(e) {
  let t = M(e.pack);
  if (t.kind !== "session")
    throw new Error(
      `UNSUPPORTED_PACK_KIND: timeline requires a session evidence pack, but "${e.pack}" is a screenshot pack.`,
    );
  let s = Gn(t, {
    aroundSceneId: e.aroundSceneId,
    fromMs: e.fromMs,
    toMs: e.toMs,
    windowMs: e.windowMs,
    kinds: e.kinds,
    includeAllConsole: e.includeAllConsole,
    includeAllNetwork: e.includeAllNetwork,
    limit: e.limit,
  });
  if (e.format === "json") return k(JSON.stringify(s, null, 2), e.maxChars);
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
    k(
      n.join(`
`),
      e.maxChars,
    )
  );
}
var Gr = new Set([
  "unfold",
  "bizError",
  "biz_error",
  "settled",
  "final",
  "outline",
  "diff",
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
  "includeNoise",
  "include_noise",
  "apiOnly",
  "api_only",
]);
function Xr(e) {
  let t = {},
    s = [];
  for (let r = 0; r < e.length; r++) {
    let a = e[r];
    if (a === "--") {
      s.push(...e.slice(r + 1));
      break;
    }
    if (a.startsWith("--")) {
      let l = a.indexOf("=");
      if (l > 2) {
        let i = a.slice(2, l),
          u = a.slice(l + 1);
        t[i] = u;
      } else {
        let i = a.slice(2);
        if (Gr.has(i)) {
          let c = e[r + 1]?.toLowerCase();
          c === "true" ||
          c === "false" ||
          c === "1" ||
          c === "0" ||
          c === "yes" ||
          c === "no"
            ? ((t[i] = c === "true" || c === "1" || c === "yes"), r++)
            : (t[i] = !0);
          continue;
        }
        let u = e[r + 1];
        u !== void 0 && !u.startsWith("--") ? ((t[i] = u), r++) : (t[i] = !0);
      }
      continue;
    }
    let o = /^([a-zA-Z][a-zA-Z0-9_]*)=(.+)$/.exec(a);
    if (o && !nt(a)) {
      t[o[1]] = o[2];
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
      for (let [a, o] of Object.entries(r))
        typeof o == "boolean" || typeof o == "string"
          ? (t[a] = o)
          : typeof o == "number"
            ? (t[a] = String(o))
            : Array.isArray(o) && (t[a] = o.join(","));
    } catch {}
  return { flags: t, positionals: s };
}
function C(e, ...t) {
  for (let s of t) {
    let n = e[s];
    if (typeof n == "string" && n.trim().length > 0) return n.trim();
  }
}
function P(e, ...t) {
  let s = C(e, ...t);
  if (s === void 0) return;
  let n = Number(s);
  return Number.isFinite(n) ? n : void 0;
}
function _(e, ...t) {
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
function ve(e, ...t) {
  let s = C(e, ...t);
  if (!s) return;
  let n = s
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  return n.length > 0 ? n : void 0;
}
function Vr(e) {
  return e ? (/\.zip$/i.test(e) ? !0 : nt(e)) : !1;
}
function O(e, t, s = !1) {
  let n = C(e, "pack", "p");
  return n
    ? { pack: n, rest: t }
    : t.length > 0 && (s || Vr(t[0]))
      ? { pack: t[0], rest: t.slice(1) }
      : { pack: void 0, rest: t };
}
function tt(e) {
  return e.filter((t) => t.type === "text").map((t) => t.text).join(`

`);
}
function Zr() {
  return `Bug Lens Evidence Triage CLI
Usage: node bug-lens-cli.mjs <command> [options]

Commands:
  contract                                    Print skill contract JSON (impl version, capabilities, commands, workspace namespace)
  open_pack <zipOrDir>                        Extract pack to workspace (idempotent), generate derived JSON & INDEX.md, cache session path, and print overview
  get_scene [--selector S] [--cssProperty P]  Inspect issue scene (session) or DOM anchor & CSS cascade rules (screenshot)
  get_css [--scene ID] [--property P]       Inspect winner CSS rules & computed layout styles (v5 dom-styles / cascade)
  get_screenshot [--step N] [--settled|--final] Locate screenshot image (instant, settled, final, or issue) and print path
  compare_frames [--step N] [--final|--to M]  Compare before/after visual frames (instant vs settled, or step vs final)
  timeline [--aroundSceneId ID] [--windowMs]  Unified chronological timeline of interactions, console errors, and network requests
  query_console [--levels error,warning]      Filter console logs (folded by fingerprint; supports --unfold, --minCount, --includeNoise)
  query_network [--status failed|biz_error]   Filter network requests (prioritizes failures, supports --bizError, --apiOnly)
  get_request <id> [--include body] [--outline] Inspect request headers, request body, initiator stack, response body, or JSON outline
  compare_requests <leftId> <rightId> [--part response|request|headers|both] [--jsonPath EXPR] [--ignoreKeys k1,k2] [--maxDiffs N]  Diff JSON or text request/response/headers between two network requests
  get_interactions [--fromIndex N] [--limit]  List recorded user interactions
  get_framework_state [--component NAME] [--diff] Inspect Vue/React component props, state, diff across snapshots, and webStorage snapshots
  search_pack <query>                         Cross-search console, network URLs/bodies, interactions, cascade rules, and state
  read_pack_file <path> [--jsonPath EXPR]     Read raw JSON/JS/text file or workspace artifact (INDEX.md, data/*.json)
  extract_pack [--dest DIR]                   Describe active workspace or copy extracted pack to custom directory`;
}
function Yr(e) {
  let t = e[0]?.trim();
  if (
    !t ||
    t === "-h" ||
    t === "--help" ||
    t === "help" ||
    e.slice(1).some((l) => l === "-h" || l === "--help")
  )
    return Zr();
  let s = t.replace(/-/g, "_").toLowerCase(),
    { flags: n, positionals: r } = Xr(e.slice(1)),
    a = C(n, "format") === "json" ? "json" : "text",
    o = P(n, "maxChars", "max_chars");
  switch (s) {
    case "contract":
      return Wt(Ie());
    case "open_pack": {
      let { pack: l } = O(n, r, !0);
      if (!l)
        throw new Error(
          "Usage: bug-lens-cli.mjs open_pack <zipPath> [--format text|json]",
        );
      return Bn({ pack: l, format: a, maxChars: o });
    }
    case "get_scene": {
      let { pack: l, rest: i } = O(n, r),
        u = P(n, "sceneIndex", "scene_index", "index"),
        c = C(n, "sceneId", "scene_id"),
        f = C(n, "selector", "s") ?? i[0],
        p = C(n, "cssProperty", "css_property", "prop"),
        h = _(
          n,
          "includeImage",
          "include_image",
          "includeScreenshot",
          "include_screenshot",
        ),
        m = Ln({
          pack: l,
          sceneId:
            c ?? (u === void 0 && i[0] && /^\d+$/.test(i[0]) ? i[0] : void 0),
          sceneIndex: u,
          selector: f,
          cssProperty: p,
          includeImage: h,
          format: a,
          maxChars: o,
        });
      return tt(m);
    }
    case "get_screenshot": {
      let { pack: l, rest: i } = O(n, r),
        u = C(n, "kind") ?? i[0],
        c = P(n, "step"),
        f = _(n, "settled"),
        p = _(n, "final"),
        h = C(n, "sceneId", "scene_id"),
        m = Fn({ pack: l, kind: u, step: c, settled: f, final: p, sceneId: h });
      return tt(m);
    }
    case "get_css": {
      let { pack: l, rest: i } = O(n, r);
      return In({
        pack: l,
        scene: C(n, "scene") ?? i[0],
        sceneId: C(n, "sceneId", "scene_id"),
        sceneIndex: P(n, "sceneIndex", "scene_index", "index"),
        selector: C(n, "selector", "s"),
        property: C(n, "property", "cssProperty", "css_property", "prop"),
        format: a,
        maxChars: o,
      });
    }
    case "compare_frames": {
      let { pack: l } = O(n, r),
        i = _(
          n,
          "includeImage",
          "include_image",
          "includeScreenshot",
          "include_screenshot",
        ),
        u = xn({
          pack: l,
          step: P(n, "step"),
          from: P(n, "from"),
          to: P(n, "to"),
          against: C(n, "against"),
          settled: _(n, "settled"),
          final: _(n, "final"),
          left: C(n, "left"),
          right: C(n, "right"),
          includeImage: i,
          format: a,
          maxChars: o,
        });
      return tt(u);
    }
    case "timeline": {
      let { pack: l, rest: i } = O(n, r),
        u = C(n, "aroundSceneId", "around_scene_id", "around") ?? i[0],
        c = u?.startsWith("scene:")
          ? String(Math.max(0, Number(u.slice(6)) - 1))
          : u;
      return Xn({
        pack: l,
        aroundSceneId: c,
        fromMs: P(n, "fromMs", "from_ms"),
        toMs: P(n, "toMs", "to_ms"),
        windowMs: P(n, "windowMs", "window_ms"),
        kinds: ve(n, "kinds", "kind"),
        includeAllConsole: _(n, "includeAllConsole", "include_all_console"),
        includeAllNetwork: _(n, "includeAllNetwork", "include_all_network"),
        limit: P(n, "limit"),
        format: a,
        maxChars: o,
      });
    }
    case "query_console": {
      let { pack: l, rest: i } = O(n, r);
      return zn({
        pack: l,
        levels: ve(n, "levels", "level"),
        search: C(n, "search", "query", "q") ?? i[0],
        regex: C(n, "regex"),
        fromMs: P(n, "fromMs", "from_ms"),
        toMs: P(n, "toMs", "to_ms"),
        offset: P(n, "offset"),
        limit: P(n, "limit"),
        unfold: _(n, "unfold"),
        minCount: P(n, "minCount", "min_count"),
        includeNoise: _(n, "includeNoise", "include_noise"),
        format: a,
        maxChars: o,
      });
    }
    case "query_network": {
      let { pack: l, rest: i } = O(n, r),
        u = C(n, "status"),
        c = _(n, "bizError", "biz_error"),
        f = C(n, "bizCode", "biz_code"),
        p =
          u === "biz_error" || u === "bizError"
            ? "biz_error"
            : u && /^\d+(,\d+)*$/.test(u)
              ? u.split(",").map(Number)
              : u;
      return qn({
        pack: l,
        status: p,
        bizError: c,
        bizCode: f,
        urlContains: C(n, "urlContains", "url_contains", "url") ?? i[0],
        method: C(n, "method"),
        type: C(n, "type"),
        apiOnly: _(n, "apiOnly", "api_only"),
        offset: P(n, "offset"),
        limit: P(n, "limit"),
        format: a,
        maxChars: o,
      });
    }
    case "get_request": {
      let { pack: l, rest: i } = O(n, r),
        u = C(n, "id", "requestId", "request_id") ?? i[0];
      if (!u)
        throw new Error(
          "Usage: bug-lens-cli.mjs get_request <id> [--jsonPath EXPR] [--outline]",
        );
      return Cn({
        pack: l,
        id: u,
        include: ve(n, "include"),
        jsonPath: C(n, "jsonPath", "json_path") ?? i[1],
        bodyMaxChars: P(n, "bodyMaxChars", "body_max_chars"),
        outline: _(n, "outline"),
        format: a,
        maxChars: o,
      });
    }
    case "compare_requests": {
      let { pack: l, rest: i } = O(n, r),
        u = C(n, "left", "from") ?? i[0],
        c = C(n, "right", "to") ?? i[1];
      if (!u || !c)
        throw new Error(
          "Usage: bug-lens-cli.mjs compare_requests <leftId> <rightId> [--part response|request|headers|both] [--jsonPath EXPR] [--ignoreKeys k1,k2] [--maxDiffs N]",
        );
      let f = C(n, "part");
      return Nn({
        pack: l,
        left: u,
        right: c,
        part: f,
        jsonPath: C(n, "jsonPath", "json_path"),
        ignoreKeys: ve(n, "ignoreKeys", "ignore_keys"),
        maxDiffs: P(n, "maxDiffs", "max_diffs"),
        format: a,
        maxChars: o,
      });
    }
    case "get_interactions": {
      let { pack: l } = O(n, r),
        i = On({
          pack: l,
          fromIndex: P(n, "fromIndex", "from_index"),
          limit: P(n, "limit"),
          kinds: ve(n, "kinds", "kind"),
          includeScreenshot: _(n, "includeScreenshot", "include_screenshot"),
          format: a,
          maxChars: o,
        });
      return tt(i);
    }
    case "get_framework_state": {
      let { pack: l, rest: i } = O(n, r);
      return _n({
        pack: l,
        index: P(n, "index"),
        nearMs: P(n, "nearMs", "near_ms"),
        component: C(n, "component") ?? i[0],
        path: C(n, "path", "jsonPath", "json_path"),
        diff: _(n, "diff"),
        compareFrom: P(n, "compareFrom", "compare_from"),
        compareTo: P(n, "compareTo", "compare_to"),
        format: a,
        maxChars: o,
      });
    }
    case "search_pack": {
      let { pack: l, rest: i } = O(n, r),
        u = C(n, "query", "q") ?? i[0];
      if (!u) throw new Error("Usage: bug-lens-cli.mjs search_pack <query>");
      return Kn({
        pack: l,
        query: u,
        scopes: ve(n, "scopes", "scope"),
        limit: P(n, "limit"),
        contextChars: P(n, "contextChars", "context_chars"),
        format: a,
        maxChars: o,
      });
    }
    case "read_pack_file": {
      let { pack: l, rest: i } = O(n, r),
        u = C(n, "path", "file") ?? i[0];
      if (!u)
        throw new Error(
          "Usage: bug-lens-cli.mjs read_pack_file <path> [--jsonPath EXPR]",
        );
      return Wn({
        pack: l,
        path: u,
        jsonPath: C(n, "jsonPath", "json_path") ?? i[1],
        offset: P(n, "offset"),
        maxChars: o,
      });
    }
    case "extract_pack": {
      let { pack: l, rest: i } = O(n, r);
      return Mn({ pack: l, dest: C(n, "dest", "d") ?? i[0], format: a });
    }
    default:
      throw new Error(
        `UNKNOWN_COMMAND: Unknown command "${t}". Run with --help to see available commands.`,
      );
  }
}
function Qr() {
  if (typeof process > "u" || !Array.isArray(process.argv) || !process.argv[1])
    return !1;
  let e = process.argv[1];
  if (e.endsWith("bug-lens-cli.mjs") || e.endsWith("cli.ts")) return !0;
  try {
    let t = Kr(import.meta.url),
      s = Hr(e),
      n = nt(s) ? Vn(s) : s,
      r = nt(t) ? Vn(t) : t;
    return n === r;
  } catch {
    return !1;
  }
}
var eo = Qr();
if (eo)
  try {
    let e = Yr(process.argv.slice(2));
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
export { Yr as runTriageCli };
