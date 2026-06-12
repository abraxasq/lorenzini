/* Lorenzini in-site Markdown editor.
 * Pure client-side: talks to the GitHub Contents API using a fine-grained PAT
 * kept in localStorage. No backend, no build step. */
(function () {
  "use strict";

  var CFG = window.LORENZINI_EDITOR;
  var API = "https://api.github.com";
  var TOKEN_KEY = "lorenzini_gh_pat";

  // --- element refs -------------------------------------------------------
  var $ = function (id) { return document.getElementById(id); };
  var gate = $("gate"), app = $("app");
  var patInput = $("patInput"), rememberToken = $("rememberToken");
  var saveTokenBtn = $("saveTokenBtn"), logoutBtn = $("logoutBtn"), userBadge = $("userBadge");
  var fileSelect = $("fileSelect"), newPostBtn = $("newPostBtn");
  var titleInput = $("titleInput"), dateInput = $("dateInput"), filenameInput = $("filenameInput");
  var tagChecks = $("tagChecks"), saveBtn = $("saveBtn"), resetBtn = $("resetBtn"), statusEl = $("status");
  var toast = $("toast");

  var token = sessionToken();
  var easyMDE = null;
  // currentFile: { path, sha } for the post being edited; sha null => new file.
  var currentFile = { path: null, sha: null };

  // --- token storage ------------------------------------------------------
  function sessionToken() {
    try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || null; }
    catch (e) { return null; }
  }
  function storeToken(t, persist) {
    token = t;
    try {
      if (persist) { localStorage.setItem(TOKEN_KEY, t); sessionStorage.removeItem(TOKEN_KEY); }
      else { sessionStorage.setItem(TOKEN_KEY, t); localStorage.removeItem(TOKEN_KEY); }
    } catch (e) { /* storage may be blocked; keep in-memory token */ }
  }
  function clearToken() {
    token = null;
    try { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }

  // --- UTF-8 safe base64 --------------------------------------------------
  function b64encode(str) { return btoa(unescape(encodeURIComponent(str))); }
  function b64decode(b64) { return decodeURIComponent(escape(atob(b64.replace(/\n/g, "")))); }

  // --- toast / status -----------------------------------------------------
  var toastTimer = null;
  function showToast(msg, kind) {
    toast.textContent = msg;
    toast.className = "show" + (kind ? " " + kind : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.className = ""; }, 4000);
  }
  function setStatus(msg) { statusEl.textContent = msg || ""; }

  // --- GitHub API ---------------------------------------------------------
  function gh(path, opts) {
    opts = opts || {};
    return fetch(API + path, {
      method: opts.method || "GET",
      headers: {
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error((data && data.message) || ("GitHub API " + res.status));
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  // --- slug / filename ----------------------------------------------------
  function slugify(s) {
    return s.toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")     // non-alnum (incl. apostrophes) -> hyphen, matches repo convention
      .replace(/-{2,}/g, "-")          // collapse repeats
      .replace(/^-+|-+$/g, "");        // trim hyphens
  }
  function buildFilename(date, title) {
    return date + "-" + (slugify(title) || "post") + ".md";
  }

  // --- frontmatter --------------------------------------------------------
  function parseDoc(text) {
    var fm = { title: "", date: "", tags: [], layout: "post" };
    var body = text;
    var m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(text);
    if (m) {
      body = m[2];
      m[1].split("\n").forEach(function (line) {
        var kv = /^(\w+)\s*:\s*(.*)$/.exec(line);
        if (!kv) return;
        var key = kv[1], val = kv[2].trim();
        if (key === "tags") {
          val = val.replace(/^\[|\]$/g, "");
          fm.tags = val.split(",").map(function (t) { return t.trim().replace(/^["']|["']$/g, ""); }).filter(Boolean);
        } else if (key === "title") {
          fm.title = val.replace(/^["']|["']$/g, "");
        } else if (key === "date") {
          fm.date = val.split(" ")[0];
        } else {
          fm[key] = val;
        }
      });
    }
    return { fm: fm, body: body };
  }

  function buildDoc(fm, body) {
    var fmLines = [
      "---",
      "layout: " + (fm.layout || "post"),
      'title: "' + String(fm.title).replace(/"/g, '\\"') + '"',
      "date: " + fm.date,
      "tags: [" + fm.tags.join(", ") + "]",
      "---"
    ];
    var cleanBody = body.replace(/^\n+/, "").replace(/\s*$/, "");
    return fmLines.join("\n") + "\n\n" + cleanBody + "\n";
  }

  // --- form helpers -------------------------------------------------------
  function renderTagChecks() {
    tagChecks.innerHTML = "";
    CFG.tags.forEach(function (t) {
      var id = "tag-" + t;
      var label = document.createElement("label");
      label.innerHTML = '<input type="checkbox" id="' + id + '" value="' + t + '"> ' + t;
      tagChecks.appendChild(label);
    });
  }
  function getCheckedTags() {
    return Array.prototype.slice.call(tagChecks.querySelectorAll("input:checked"))
      .map(function (el) { return el.value; });
  }
  function setCheckedTags(tags) {
    tagChecks.querySelectorAll("input").forEach(function (el) {
      el.checked = tags.indexOf(el.value) !== -1;
    });
  }

  function fillForm(fm, body, path, sha) {
    titleInput.value = fm.title || "";
    dateInput.value = fm.date || todayISO();
    setCheckedTags(fm.tags || []);
    filenameInput.value = path ? path.split("/").pop() : "";
    easyMDE.value(body || "");
    currentFile = { path: path || null, sha: sha || null };
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  // --- load posts ---------------------------------------------------------
  function loadPostList() {
    setStatus("목록 불러오는 중…");
    return gh("/repos/" + CFG.owner + "/" + CFG.repo + "/contents/" + CFG.dir + "?ref=" + CFG.branch)
      .then(function (items) {
        fileSelect.innerHTML = '<option value="">— 포스트를 선택하세요 —</option>';
        items.filter(function (it) { return it.type === "file" && /\.md$/i.test(it.name); })
          .sort(function (a, b) { return a.name < b.name ? 1 : -1; }) // newest (date-prefixed) first
          .forEach(function (it) {
            var opt = document.createElement("option");
            opt.value = it.path;
            opt.textContent = it.name;
            fileSelect.appendChild(opt);
          });
        setStatus("");
      });
  }

  function openPost(path) {
    setStatus("불러오는 중…");
    gh("/repos/" + CFG.owner + "/" + CFG.repo + "/contents/" + path + "?ref=" + CFG.branch)
      .then(function (data) {
        var text = b64decode(data.content);
        var parsed = parseDoc(text);
        fillForm(parsed.fm, parsed.body, data.path, data.sha);
        setStatus("");
      })
      .catch(function (err) { showToast("불러오기 실패: " + err.message, "err"); setStatus(""); });
  }

  // --- save ---------------------------------------------------------------
  function save() {
    var title = titleInput.value.trim();
    var date = dateInput.value || todayISO();
    if (!title) { showToast("제목을 입력하세요", "err"); return; }

    var isNew = !currentFile.sha;
    var filename = isNew ? buildFilename(date, title) : currentFile.path.split("/").pop();
    if (isNew && filenameInput.value.trim()) filename = filenameInput.value.trim();
    if (!/\.md$/i.test(filename)) filename += ".md";
    var path = CFG.dir + "/" + filename;

    var fm = { layout: "post", title: title, date: date, tags: getCheckedTags() };
    var content = buildDoc(fm, easyMDE.value());

    var body = {
      message: (isNew ? "Add post: " : "Update post: ") + title,
      content: b64encode(content),
      branch: CFG.branch
    };
    if (currentFile.sha) body.sha = currentFile.sha;

    saveBtn.disabled = true;
    setStatus("저장 중…");
    gh("/repos/" + CFG.owner + "/" + CFG.repo + "/contents/" + path, { method: "PUT", body: body })
      .then(function (data) {
        currentFile = { path: data.content.path, sha: data.content.sha };
        filenameInput.value = filename;
        setStatus("");
        showToast((isNew ? "새 글 생성됨" : "저장됨") + " — 사이트 재빌드 중 (약 1분)", "ok");
        return loadPostList().then(function () { fileSelect.value = data.content.path; });
      })
      .catch(function (err) {
        showToast("저장 실패: " + err.message, "err");
        setStatus("");
      })
      .then(function () { saveBtn.disabled = false; });
  }

  // --- new post -----------------------------------------------------------
  function newPost() {
    fileSelect.value = "";
    fillForm({ title: "", date: todayISO(), tags: [], layout: "post" }, "", null, null);
    titleInput.focus();
  }

  // --- auth flow ----------------------------------------------------------
  function enterApp() {
    gate.classList.add("hidden");
    app.classList.remove("hidden");
    logoutBtn.classList.remove("hidden");
    if (!easyMDE) {
      easyMDE = new EasyMDE({
        element: $("mdEditor"),
        spellChecker: false,
        autoDownloadFontAwesome: true,
        status: ["lines", "words"],
        placeholder: "여기에 마크다운으로 본문을 작성하세요…",
        toolbar: ["bold", "italic", "heading", "|", "quote", "unordered-list", "ordered-list",
                  "|", "link", "image", "code", "|", "preview", "side-by-side", "fullscreen", "|", "guide"]
      });
    }
    renderTagChecks();
    loadPostList().catch(function (err) {
      showToast("목록 실패: " + err.message, "err");
    });
    // greet
    gh("/user").then(function (u) {
      userBadge.textContent = "@" + u.login;
    }).catch(function () { /* token may lack user read; ignore */ });
  }

  function connect(t, persist) {
    token = t;
    setStatus("연결 확인 중…");
    // Verify the token can read the repo contents dir before entering.
    gh("/repos/" + CFG.owner + "/" + CFG.repo)
      .then(function () {
        storeToken(t, persist);
        setStatus("");
        enterApp();
      })
      .catch(function (err) {
        token = null;
        setStatus("");
        var msg = err.status === 401 ? "토큰이 유효하지 않습니다" :
                  err.status === 403 || err.status === 404 ? "이 저장소에 접근 권한이 없습니다 (Contents 권한 확인)" :
                  err.message;
        showToast("연결 실패: " + msg, "err");
      });
  }

  // --- events -------------------------------------------------------------
  saveTokenBtn.addEventListener("click", function () {
    var t = patInput.value.trim();
    if (!t) { showToast("토큰을 입력하세요", "err"); return; }
    connect(t, rememberToken.checked);
  });
  patInput.addEventListener("keydown", function (e) { if (e.key === "Enter") saveTokenBtn.click(); });

  logoutBtn.addEventListener("click", function () {
    clearToken();
    app.classList.add("hidden");
    logoutBtn.classList.add("hidden");
    userBadge.textContent = "";
    patInput.value = "";
    gate.classList.remove("hidden");
    showToast("토큰을 삭제했습니다");
  });

  fileSelect.addEventListener("change", function () {
    if (fileSelect.value) openPost(fileSelect.value);
  });
  newPostBtn.addEventListener("click", newPost);
  saveBtn.addEventListener("click", save);
  resetBtn.addEventListener("click", function () {
    if (currentFile.path) openPost(currentFile.path);
    else newPost();
  });

  // auto-update filename preview for new posts as title/date change
  function refreshFilenamePreview() {
    if (!currentFile.sha && !filenameInput.dataset.touched) {
      filenameInput.value = buildFilename(dateInput.value || todayISO(), titleInput.value || "");
    }
  }
  titleInput.addEventListener("input", refreshFilenamePreview);
  dateInput.addEventListener("change", refreshFilenamePreview);
  filenameInput.addEventListener("input", function () { filenameInput.dataset.touched = "1"; });
  newPostBtn.addEventListener("click", function () { delete filenameInput.dataset.touched; });

  // --- boot ---------------------------------------------------------------
  if (token) {
    connect(token, !!localStorage.getItem(TOKEN_KEY));
  }
})();
