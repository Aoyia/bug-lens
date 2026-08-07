import { t } from "../shared/i18n.ts";

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]!
  );
}

export function highlightJs(code: string): string {
  const escaped = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped.replace(
    /(\/\/[^\n]*)|(\/\*[\s\S]*?\*\/)|(`(?:[^`\\$]|\\.|\$\{[^}]*\})*`)|('(?:[^'\\]|\\.)*')|("(?:[^"\\]|\\.)*")|(\b(?:import|from|const|let|var|async|await|function|new|return|if|else|for|of|in|true|false|null|undefined|typeof|void|throw|try|catch|finally|class|extends|export|default|this|super|instanceof|typeof|delete|switch|case|break|continue|while|do|yield|with|debugger)\b)|(\b(?:test|expect|describe|beforeAll|beforeEach|afterAll|afterEach|page|console|Buffer|it|xdescribe|xit|fit|fdescribe|jest)\b)|(\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(=>|===|!==|==|!=|>=|<=|&&|\|\||\?\?|[-+*/%]=?|={1,3}|!|&|\||\^|~|<<|>>|>>>|[{}()\[\];:.,<>?])/g,
    (
      match,
      comment,
      multilineComment,
      templateStr,
      singleStr,
      doubleStr,
      keyword,
      builtin,
      number
    ) => {
      if (comment) return `<span class="jsc">${comment}</span>`;
      if (multilineComment)
        return `<span class="jsc">${multilineComment}</span>`;
      if (templateStr || singleStr || doubleStr)
        return `<span class="jss">${match}</span>`;
      if (keyword) return `<span class="jsk">${match}</span>`;
      if (builtin) return `<span class="jsb">${match}</span>`;
      if (number) return `<span class="jsn">${match}</span>`;
      if (match) return `<span class="jsp">${match}</span>`;
      return match;
    }
  );
}

function highlightJson(json: string): string {
  const safeJson = json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return safeJson.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?|[{}\[\]:,])/g,
    (match) => {
      if (match.startsWith('"')) {
        if (match.endsWith(":")) {
          return `<span class="jk">${match.slice(0, -1)}</span><span class="jp">:</span>`;
        }
        return `<span class="js">${match}</span>`;
      }
      if (match === "true" || match === "false")
        return `<span class="jb">${match}</span>`;
      if (match === "null") return `<span class="jnull">${match}</span>`;
      if (/^-?\d/.test(match)) return `<span class="jn">${match}</span>`;
      if (/[{}[\]:,]/.test(match)) return `<span class="jp">${match}</span>`;
      return match;
    }
  );
}

export function renderCodeBlockHtml(
  rawText: string,
  isJsonCandidate = false
): string {
  let text = rawText;
  let isFormattedJson = false;

  if (isJsonCandidate || /^[\s]*[\[{]/.test(rawText)) {
    try {
      text = JSON.stringify(JSON.parse(rawText), null, 2);
      isFormattedJson = true;
    } catch {
      // The original text is still safe to render after HTML escaping.
    }
  }

  const content = isFormattedJson ? highlightJson(text) : escapeHtml(text);
  return `
    <div class="code-wrapper">
      <button class="code-copy-btn" type="button" title="${t("copyContentTitle")}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
      </button>
      <div class="code">${content}</div>
    </div>
  `;
}
