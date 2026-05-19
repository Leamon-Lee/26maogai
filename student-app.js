(() => {
  const STORAGE_META_KEY = "student_sessions_meta_v2";
  const STORAGE_SESSION_PREFIX = "student_session_v2_";
  const PAGE_BANK_URL = "./data-qna.json";

  const normalizeSpaces = (value) => String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const safeJsonParse = (text, fallback = null) => {
    try {
      return JSON.parse(text);
    } catch {
      return fallback;
    }
  };

  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);

  const downloadJson = (filename, data) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  function normalizeAnswer(value) {
    return normalizeSpaces(value)
      .replace(/[，、；;]/g, ",")
      .replace(/\s+/g, "")
      .toUpperCase();
  }

  function splitAnswerParts(value) {
    const cleaned = normalizeAnswer(value);
    if (!cleaned) return [];
    return cleaned.split(",").filter(Boolean);
  }

  function normalizeJudgement(value) {
    const text = normalizeSpaces(value).toLowerCase();
    if (["\u6b63\u786e", "\u5bf9", "t", "true", "y", "yes", "1"].includes(text)) return "\u6b63\u786e";
    if (["\u9519\u8bef", "\u9519", "f", "false", "n", "no", "0"].includes(text)) return "\u9519\u8bef";
    return normalizeSpaces(value);
  }

  function compareAnswers(userText, correctText) {
    const userParts = splitAnswerParts(userText);
    const correctParts = splitAnswerParts(correctText);
    if (!userParts.length && !correctParts.length) return null;

    if (userParts.length || correctParts.length) {
      const userJoined = userParts.slice().sort().join(",");
      const correctJoined = correctParts.slice().sort().join(",");
      if (userJoined === correctJoined && userJoined) return true;
    }

    const userSingle = normalizeAnswer(userText);
    const correctSingle = normalizeAnswer(correctText);
    if (userSingle && userSingle === correctSingle) return true;

    const userJudge = normalizeJudgement(userText);
    const correctJudge = normalizeJudgement(correctText);
    if (userJudge && correctJudge && userJudge === correctJudge) return true;

    return false;
  }

  function normalizeQuestion(item, index) {
    const obj = isObject(item) ? item : {};
    const options = Array.isArray(obj.options)
      ? obj.options
          .map((option) => ({
            key: normalizeSpaces(option?.key || option?.label || ""),
            content: normalizeSpaces(option?.content || option?.text || ""),
          }))
          .filter((option) => option.key || option.content)
      : [];

    const correctAnswers = Array.isArray(obj.correct_answers)
      ? obj.correct_answers.map((item) => normalizeSpaces(item)).filter(Boolean)
      : typeof obj.correct_answer_text === "string"
        ? splitAnswerParts(obj.correct_answer_text)
        : [];

    return {
      id: normalizeSpaces(obj.id || obj.question_id || obj.questionId || `q${index + 1}`),
      type: ["single", "multiple", "judge"].includes(obj.type) ? obj.type : "single",
      question: normalizeSpaces(obj.question || obj.text || obj.stem || "[空题]"),
      options,
      correct_answers: correctAnswers,
      score: Number.isFinite(Number(obj.score)) ? Number(obj.score) : 5,
      explanation: normalizeSpaces(obj.explanation || ""),
    };
  }

  function normalizeBank(raw) {
    const root = Array.isArray(raw) ? { questions: raw } : isObject(raw) ? raw : { questions: [] };
    const rawQuestions = Array.isArray(root.questions) ? root.questions : [];
    return {
      quiz_id: normalizeSpaces(root.quiz_id || root.quizId || "test_001"),
      title: normalizeSpaces(root.title || "棰樺簱"),
      questions: rawQuestions.map((item, index) => normalizeQuestion(item, index)),
    };
  }

  function createEmptySession(id) {
    return {
      test_session_id: id,
      records: [],
    };
  }

  function normalizeSession(session, bank) {
    const current = isObject(session) ? session : createEmptySession("test1");
    const existing = new Map(
      Array.isArray(current.records)
        ? current.records.map((record) => [String(record.question_id), record])
        : []
    );
    return {
      test_session_id: String(current.test_session_id || "test1"),
      records: bank.questions.map((question) => {
        const previous = existing.get(String(question.id));
        return {
          question_id: String(question.id),
          user_answer_text: normalizeSpaces(previous?.user_answer_text || ""),
          correct_answer_text: normalizeSpaces(previous?.correct_answer_text || question.correct_answers.join(",")),
        };
      }),
    };
  }

  function loadMeta() {
    const meta = safeJsonParse(localStorage.getItem(STORAGE_META_KEY), null);
    if (!meta || !Array.isArray(meta.sessions)) {
      return { sessions: [], activeId: "" };
    }
    return {
      sessions: meta.sessions.filter((item) => item && typeof item.id === "string"),
      activeId: typeof meta.activeId === "string" ? meta.activeId : "",
    };
  }

  function saveMeta(meta) {
    localStorage.setItem(STORAGE_META_KEY, JSON.stringify(meta));
  }

  function getSessionKey(sessionId) {
    return `${STORAGE_SESSION_PREFIX}${sessionId}`;
  }

  function loadSession(sessionId) {
    return safeJsonParse(localStorage.getItem(getSessionKey(sessionId)), createEmptySession(sessionId)) || createEmptySession(sessionId);
  }

  function saveSession(session) {
    localStorage.setItem(getSessionKey(session.test_session_id), JSON.stringify(session));
  }

  function nextSessionId(sessions) {
    const nums = sessions
      .map((item) => /^test(\d+)$/i.exec(item.id)?.[1])
      .filter(Boolean)
      .map(Number);
    return `test${nums.length ? Math.max(...nums) + 1 : 1}`;
  }

  function createApp() {
    const app = {
      bank: null,
      sessionsMeta: loadMeta(),
      activeSessionId: "",
      activeSession: null,
      reviewMode: false,
      reviewScope: "all",
      bankLoaded: false,
      typeFilter: "all",
      stateFilter: "all",
    };

    function getRecord(questionId) {
      return app.activeSession?.records?.find((item) => String(item.question_id) === String(questionId));
    }

    function persistActiveSession() {
      if (!app.activeSession) return;
      saveSession(app.activeSession);
      saveMeta(app.sessionsMeta);
    }

    function setActiveSession(sessionId) {
      if (!app.bank) return;
      persistActiveSession();
      app.activeSessionId = sessionId;
      const loaded = loadSession(sessionId);
      app.activeSession = normalizeSession(loaded, app.bank);
      saveSession(app.activeSession);
      app.sessionsMeta.activeId = sessionId;
      saveMeta(app.sessionsMeta);
      renderSessionSelect();
      renderHeader();
      renderTiles();
      renderQuestions();
    }

    function createSession() {
      if (!app.bank) return;
      const newId = nextSessionId(app.sessionsMeta.sessions);
      app.sessionsMeta.sessions.push({
        id: newId,
        name: newId,
        createdAt: Date.now(),
      });
      app.sessionsMeta.activeId = newId;
      saveMeta(app.sessionsMeta);
      app.activeSessionId = newId;
      app.activeSession = normalizeSession(createEmptySession(newId), app.bank);
      saveSession(app.activeSession);
      renderSessionSelect();
      renderHeader();
      renderTiles();
      renderQuestions();
    }

    function deleteSession() {
      if (!app.activeSession) return;
      if (!confirm(`确定删除 ${app.activeSessionId} 吗？`)) return;
      localStorage.removeItem(getSessionKey(app.activeSessionId));
      app.sessionsMeta.sessions = app.sessionsMeta.sessions.filter((item) => item.id !== app.activeSessionId);
      app.activeSessionId = app.sessionsMeta.sessions[0]?.id || "";
      app.sessionsMeta.activeId = app.activeSessionId;
      saveMeta(app.sessionsMeta);
      if (app.activeSessionId) {
        setActiveSession(app.activeSessionId);
      } else {
        app.activeSession = null;
        renderSessionSelect();
        renderHeader();
        renderTiles();
        renderQuestions();
      }
    }

    function updateRecord(questionId, userAnswerText, rerender = true) {
      if (!app.activeSession || !app.bank) return;
      const session = normalizeSession(app.activeSession, app.bank);
      const question = app.bank.questions.find((item) => String(item.id) === String(questionId));
      const record = session.records.find((item) => String(item.question_id) === String(questionId));
      if (record) {
        record.user_answer_text = normalizeSpaces(userAnswerText);
        record.correct_answer_text = normalizeSpaces(question?.correct_answers.join(",") || "");
      }
      app.activeSession = session;
      saveSession(session);
      renderHeader();
      renderTiles();
      if (rerender) renderQuestions();
    }

    function toggleMultipleAnswer(currentValue, optionKey) {
      const normalizedKey = normalizeAnswer(optionKey);
      const parts = splitAnswerParts(currentValue);
      const index = parts.indexOf(normalizedKey);
      if (index >= 0) {
        parts.splice(index, 1);
      } else {
        parts.push(normalizedKey);
      }
      return parts.join(",");
    }

    function isMultipleChoice(question) {
      return String(question?.type || "").toLowerCase() === "multiple";
    }

    function getSelectedKeys(answerText) {
      return new Set(splitAnswerParts(answerText));
    }

    function getAnsweredQuestions() {
      return app.bank?.questions?.filter((question) => normalizeSpaces(getRecord(question.id)?.user_answer_text || "")) || [];
    }

    function getReviewQuestions() {
      if (!app.bank?.questions?.length) return [];
      if (!app.reviewMode) return app.bank.questions;
      if (app.reviewScope === "done") return getAnsweredQuestions();
      return app.bank.questions;
    }

    function shouldSkipInReview(questionId) {
      if (!app.reviewMode || app.reviewScope !== "done") return false;
      return !normalizeSpaces(getRecord(questionId)?.user_answer_text || "");
    }

    function getQuestionStatus(record) {
      const answered = normalizeSpaces(record?.user_answer_text);
      if (!answered) return "unanswered";
      if (!app.reviewMode) return "answered";
      return compareAnswers(record.user_answer_text, record.correct_answer_text) ? "correct" : "wrong";
    }

    function passesFilters(question, record) {
      if (app.typeFilter !== "all" && String(question?.type || "") !== String(app.typeFilter)) {
        return false;
      }
      const status = getQuestionStatus(record);
      if (app.stateFilter !== "all" && status !== app.stateFilter) {
        return false;
      }
      return true;
    }

    function renderSessionSelect() {
      const select = document.getElementById("sessionSelect");
      if (!select) return;
      const options = app.sessionsMeta.sessions
        .map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === app.activeSessionId ? "selected" : ""}>${escapeHtml(item.name || item.id)}</option>`)
        .join("");
      select.innerHTML = options || `<option value="">鏆傛棤璁板綍</option>`;
      select.disabled = !app.sessionsMeta.sessions.length;
    }

    function renderHeader() {
      const scoreValueEl = document.getElementById("scoreValue");
      const scoreMetaEl = document.getElementById("scoreMeta");
      const scoreBarEl = document.getElementById("scoreBar");
      const scoreCaptionEl = document.getElementById("scoreCaption");
      const activeSessionEl = document.getElementById("activeSessionName");
      const importedNameEl = document.getElementById("importedName");
      const tileHintEl = document.getElementById("tileHint");
      const questionCount = app.bank?.questions?.length || 0;
      const answeredCount = app.activeSession?.records?.filter((item) => normalizeSpaces(item.user_answer_text)).length || 0;
      const reviewQuestions = getReviewQuestions();
      const totalScore = reviewQuestions.reduce((sum, question) => sum + (Number(question.score) || 5), 0) || 0;
      const correctCount = app.reviewMode
        ? reviewQuestions.filter((question) => {
            const record = getRecord(question.id);
            return record && compareAnswers(record.user_answer_text, record.correct_answer_text);
          }).length
        : 0;
      const earnedScore = app.reviewMode
        ? reviewQuestions.reduce((sum, question) => {
            const record = getRecord(question.id);
            return sum + (record && compareAnswers(record.user_answer_text, record.correct_answer_text) ? (Number(question.score) || 5) : 0);
          }, 0) || 0
        : 0;
      const ratio = app.reviewMode && totalScore ? Math.round((earnedScore / totalScore) * 100) : 0;
      const scopeLabel = app.reviewScope === "done" ? "\u5df2\u505a\u9898" : "\u5168\u90e8\u9898";

      if (scoreValueEl) scoreValueEl.textContent = app.reviewMode ? `${earnedScore}` : "\u2014";
      if (scoreMetaEl) scoreMetaEl.textContent = app.reviewMode ? `${earnedScore} / ${totalScore} \u5206` : `${answeredCount} / ${questionCount} \u9898\u5df2\u4fdd\u5b58`;
      if (scoreBarEl) scoreBarEl.style.width = `${ratio}%`;
      if (scoreCaptionEl) scoreCaptionEl.textContent = app.reviewMode
        ? `\u5df2\u68c0\u67e5 ${scopeLabel}\uff0c\u7b54\u5bf9 ${correctCount} \u9898\uff0c\u5df2\u4f5c\u7b54 ${answeredCount} \u9898`
        : `\u5df2\u4fdd\u5b58\u4f5c\u7b54\uff0c\u70b9\u51fb\u201c\u5bf9\u7b54\u6848\u201d\u540e\u67e5\u770b\u7ed3\u679c`;
      if (activeSessionEl) activeSessionEl.textContent = app.activeSessionId || "\u672a\u9009\u62e9\u8bb0\u5f55";
      if (importedNameEl) importedNameEl.textContent = app.bank?.title || "\u672a\u8f7d\u5165\u9898\u5e93";
      if (tileHintEl) tileHintEl.textContent = app.bankLoaded ? `${questionCount} \u9898\u5df2\u5c31\u7ee7` : "\u672a\u8f7d\u5165";
    }

    function renderTiles() {
      const container = document.getElementById("questionTiles");
      if (!container) return;
      if (!app.bank) {
        container.innerHTML = "";
        return;
      }

      container.innerHTML = app.bank.questions
        .map((question, index) => {
          const record = getRecord(question.id) || {
            user_answer_text: "",
            correct_answer_text: question.correct_answers.join(","),
          };
          if (!passesFilters(question, record)) {
            return "";
          }
          if (shouldSkipInReview(question.id)) {
            return "";
          }
          const statusClass = getQuestionStatus(record);
          return `
            <button
              type="button"
              class="tile ${statusClass}"
              data-question-id="${escapeHtml(question.id)}"
              data-num="${index + 1}"
              aria-label="${escapeHtml(question.id)}"
              title="第 ${index + 1} 题"
            >
              <span class="tile-tooltip">${index + 1}</span>
            </button>
          `;
        })
        .join("");
    }

    function renderQuestions() {
      const container = document.getElementById("questionList");
      if (!container) return;
      if (!app.bank) {
        container.innerHTML = "";
        return;
      }

      container.innerHTML = app.bank.questions
        .map((question, index) => {
          const record = getRecord(question.id) || {
            user_answer_text: "",
            correct_answer_text: question.correct_answers.join(","),
          };
          if (!passesFilters(question, record)) {
            return "";
          }
          if (shouldSkipInReview(question.id)) {
            return "";
          }
          const answered = normalizeSpaces(record.user_answer_text);
          const evaluation = app.reviewMode ? (answered ? compareAnswers(record.user_answer_text, record.correct_answer_text) : null) : null;
          const statusText = app.reviewMode
            ? !answered
              ? "\u672a\u4f5c\u7b54"
              : evaluation === null
                ? "\u672a\u4f5c\u7b54"
                : evaluation
                  ? "\u5df2\u7b54\u5bf9"
                  : "\u5df2\u7b54\u9519"
            : normalizeSpaces(record.user_answer_text)
              ? "\u5df2\u4fdd\u5b58"
              : "\u672a\u4f5c\u7b54";
          const statusClass = app.reviewMode
            ? !answered
              ? "badge-muted"
              : evaluation === null
                ? "badge-muted"
                : evaluation
                  ? "badge-success"
                  : "badge-danger"
            : normalizeSpaces(record.user_answer_text)
              ? "badge-muted"
              : "badge-muted";
          const selectedKeys = getSelectedKeys(record.user_answer_text);
          const optionButtons = Array.isArray(question.options) && question.options.length
            ? `
              <div class="option-grid">
                ${question.options
                  .map((option) => {
                    const selected = selectedKeys.has(normalizeAnswer(option.key));
                    return `
                      <button type="button" class="option-item ${selected ? "selected" : ""}" data-pick="${escapeHtml(option.key)}" data-question-id="${escapeHtml(question.id)}">
                        <span class="option-key">${escapeHtml(option.key)}</span>
                        <span class="option-content">${escapeHtml(option.content || "")}</span>
                      </button>
                    `;
                  })
                  .join("")}
              </div>
            `
            : "";
          const judgeQuick = question.type === "judge"
            ? `
              <div class="answer-tools">
                <button type="button" class="btn btn-secondary quick-answer" data-value="正确" data-question-id="${escapeHtml(question.id)}">正确</button>
                <button type="button" class="btn btn-secondary quick-answer" data-value="错误" data-question-id="${escapeHtml(question.id)}">错误</button>
              </div>
            `
            : "";

          return `
            <article class="student-question" data-question-id="${escapeHtml(question.id)}">
              <div class="question-head">
                <div class="question-id">${index + 1}. ${escapeHtml(question.id)}</div>
                <div class="question-type">${escapeHtml(question.type)}</div>
              </div>
              <div class="question-body">
                <p class="question-text">${escapeHtml(question.question)}</p>
                ${optionButtons}
                ${judgeQuick}
                <div class="answer-row">
                  <label class="answer-input">
                    <span class="helper">作答文本</span>
                    <input type="text" class="user-answer" data-question-id="${escapeHtml(question.id)}" value="${escapeHtml(record.user_answer_text || "")}" placeholder="输入答案或点击选项" />
                  </label>
                  <div class="status-line">
                    <span class="badge ${statusClass}">${escapeHtml(statusText)}</span>
                    <button type="button" class="btn btn-ghost review-toggle" data-question-id="${escapeHtml(question.id)}">
                      ${app.reviewMode ? "\u91cd\u65b0\u5bf9\u7b54\u6848" : "\u5bf9\u7b54\u6848"}
                    </button>
                  </div>
                  ${app.reviewMode && answered ? `<div class="answer-preview"><strong>\u6807\u51c6\u7b54\u6848\uff1a</strong>${escapeHtml(record.correct_answer_text || "\u6682\u65e0")}</div>` : ""}
                </div>
              </div>
            </article>
          `;
        })
        .join("");
    }

    async function loadBank(raw, sourceName = "data-qna.json") {
      app.bank = normalizeBank(raw);
      app.bankLoaded = true;
      app.sessionsMeta = loadMeta();
      if (!app.sessionsMeta.sessions.length) {
        const firstId = "test1";
        app.sessionsMeta.sessions = [{ id: firstId, name: firstId, createdAt: Date.now() }];
        app.sessionsMeta.activeId = firstId;
        saveMeta(app.sessionsMeta);
        app.activeSessionId = firstId;
        app.activeSession = normalizeSession(createEmptySession(firstId), app.bank);
        saveSession(app.activeSession);
      } else {
        app.sessionsMeta.activeId = app.sessionsMeta.activeId || app.sessionsMeta.sessions[0].id;
        saveMeta(app.sessionsMeta);
        app.activeSessionId = app.sessionsMeta.activeId;
        app.activeSession = normalizeSession(loadSession(app.activeSessionId), app.bank);
        saveSession(app.activeSession);
      }

      document.getElementById("studentApp")?.classList.remove("hidden");
      document.getElementById("loadNotice")?.classList.add("hidden");
      document.getElementById("importedName").textContent = app.bank.title || sourceName;
      renderSessionSelect();
      renderHeader();
      renderTiles();
      renderQuestions();
    }

    async function tryLoadDefaultBank() {
      if (window.__DEFAULT_QNA_DATA) {
        await loadBank(window.__DEFAULT_QNA_DATA, "data-qna.json");
        return;
      }
      try {
        const response = await fetch(PAGE_BANK_URL, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const raw = await response.json();
        await loadBank(raw, "data-qna.json");
      } catch (error) {
        console.warn("Default bank load failed:", error);
        const notice = document.getElementById("loadNotice");
        if (notice) {
          notice.classList.remove("hidden");
          notice.textContent = "\u672a\u80fd\u81ea\u52a8\u52a0\u8f7d\u9898\u5e93\uff0c\u8bf7\u786e\u8ba4 `data-qna.js` \u4e0e\u9875\u9762\u540c\u76ee\u5f55\u3002";
        }
      }
    }

    function handlePick(questionId, pickedValue) {
      const question = app.bank?.questions?.find((item) => String(item.id) === String(questionId));
      if (!question) return;
      const current = getRecord(questionId)?.user_answer_text || "";
      const nextValue = question.type === "multiple"
        ? toggleMultipleAnswer(current, pickedValue)
        : pickedValue;
      updateRecord(questionId, nextValue);
    }

    function openReviewModal() {
      const modal = document.getElementById("reviewModal");
      modal?.classList.remove("hidden");
    }

    function closeReviewModal() {
      const modal = document.getElementById("reviewModal");
      modal?.classList.add("hidden");
    }

    function startReview(scope) {
      app.reviewMode = true;
      app.reviewScope = scope;
      closeReviewModal();
      renderQuestions();
      renderTiles();
      renderHeader();
    }

    function hasUnansweredQuestions() {
      return (app.bank?.questions || []).some((question) => !normalizeSpaces(getRecord(question.id)?.user_answer_text || ""));
    }

    function mountEvents() {
      document.getElementById("saveDraftBtn")?.addEventListener("click", persistActiveSession);
      document.getElementById("exportBtn")?.addEventListener("click", () => {
        if (!app.activeSession) return;
        downloadJson(`${app.activeSession.test_session_id}.json`, app.activeSession);
      });
      document.getElementById("toggleAnswersBtn")?.addEventListener("click", () => {
        if (hasUnansweredQuestions()) {
          openReviewModal();
          return;
        }
        startReview("all");
      });
      document.getElementById("newSessionBtn")?.addEventListener("click", createSession);
      document.getElementById("deleteSessionBtn")?.addEventListener("click", deleteSession);
      document.getElementById("typeFilter")?.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement)) return;
        app.typeFilter = target.value || "all";
        renderTiles();
        renderQuestions();
      });
      document.getElementById("stateFilter")?.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement)) return;
        app.stateFilter = target.value || "all";
        renderTiles();
        renderQuestions();
      });
      document.getElementById("sessionSelect")?.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement)) return;
        if (target.value && target.value !== app.activeSessionId) {
          setActiveSession(target.value);
        }
      });

      document.getElementById("questionList")?.addEventListener("input", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        if (!target.classList.contains("user-answer")) return;
        updateRecord(target.dataset.questionId, target.value, false);
      });

      document.getElementById("questionTiles")?.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const tile = target.closest?.(".tile");
        if (tile instanceof HTMLElement) {
          const questionId = tile.dataset.questionId;
          const card = Array.from(document.querySelectorAll(".student-question")).find(
            (item) => item instanceof HTMLElement && item.dataset.questionId === questionId
          );
          if (card instanceof HTMLElement) {
            card.scrollIntoView({ behavior: "smooth", block: "center" });
            card.classList.add("jump-highlight");
            window.setTimeout(() => card.classList.remove("jump-highlight"), 900);
          }
        }
      });

      document.getElementById("questionList")?.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;

        const option = target.closest?.(".option-item");
        if (option instanceof HTMLElement) {
          const questionId = option.dataset.questionId;
          const question = app.bank?.questions?.find((item) => String(item.id) === String(questionId));
          if (!question) return;
          const value = option.dataset.pick || "";
          if (question.type === "multiple") {
            const current = getRecord(questionId)?.user_answer_text || "";
            updateRecord(questionId, toggleMultipleAnswer(current, value));
          } else {
            updateRecord(questionId, value);
          }
          return;
        }

        const quick = target.closest?.(".quick-answer");
        if (quick instanceof HTMLElement) {
          const questionId = quick.dataset.questionId;
          updateRecord(questionId, quick.dataset.value || "");
          return;
        }

        const reveal = target.closest?.(".review-toggle");
        if (reveal instanceof HTMLElement) {
          if (hasUnansweredQuestions()) {
            openReviewModal();
            return;
          }
          startReview("all");
        }
      });

      document.getElementById("reviewContinueBtn")?.addEventListener("click", () => {
        closeReviewModal();
      });
      document.getElementById("reviewDoneBtn")?.addEventListener("click", () => {
        startReview("done");
      });
      document.getElementById("reviewAllBtn")?.addEventListener("click", () => {
        startReview("all");
      });
      document.getElementById("reviewModal")?.addEventListener("click", (event) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.id === "reviewModal") {
          closeReviewModal();
        }
      });
      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeReviewModal();
      });

      window.addEventListener("beforeunload", persistActiveSession);
    }

    async function bootstrap() {
      mountEvents();
      await tryLoadDefaultBank();
    }

    return {
      bootstrap,
    };
  }

  window.StudentApp = createApp();
})();


