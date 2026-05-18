const STORAGE_META_KEY = "quiz_sessions_meta_v1";
const STORAGE_SESSION_PREFIX = "quiz_session_";
const TEACHER_DRAFT_KEY = "teacher_qna_draft_v1";
const TEACHER_PAGE_SIZE = 50;

const TYPE_LABELS = {
  single: "单选题",
  multiple: "多选题",
  judge: "判断题",
};

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

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function normalizeQuestionBank(raw) {
  const root = Array.isArray(raw) ? { questions: raw } : isObject(raw) ? raw : { questions: [] };
  const rawQuestions = Array.isArray(root.questions) ? root.questions : [];

  return {
    quiz_id: normalizeSpaces(root.quiz_id || root.quizId || "test_001"),
    title: normalizeSpaces(root.title || "题库"),
    questions: rawQuestions.map((item, index) => normalizeQuestion(item, index)),
  };
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

  const answerText = (() => {
    const direct = obj.correct_answer_text ?? obj.correctAnswerText ?? obj.answer_text ?? obj.answerText;
    if (typeof direct === "string") return normalizeSpaces(direct);
    if (Array.isArray(obj.correct_answers)) return normalizeSpaces(obj.correct_answers.join("、"));
    if (Array.isArray(obj.answers)) return normalizeSpaces(obj.answers.join("、"));
    return "";
  })();

  const rawId = normalizeSpaces(obj.id || obj.question_id || obj.questionId || "");
  const fallbackId = `q${index + 1}`;

  return {
    id: rawId || fallbackId,
    type: ["single", "multiple", "judge"].includes(obj.type) ? obj.type : "single",
    question: normalizeSpaces(obj.question || obj.text || obj.stem || "[空题]"),
    options,
    correct_answer_text: answerText,
  };
}

function normalizeTeacherQuestion(item, index) {
  const obj = isObject(item) ? item : {};
  const options = Array.isArray(obj.options)
    ? obj.options
        .map((option) => ({
          key: normalizeSpaces(option?.key || option?.label || ""),
          content: normalizeSpaces(option?.content || option?.text || ""),
        }))
        .filter((option) => option.key || option.content)
    : [];

  const correctAnswers = (() => {
    if (Array.isArray(obj.correct_answers)) {
      return obj.correct_answers.map((item) => normalizeSpaces(item)).filter(Boolean);
    }
    if (typeof obj.correct_answer_text === "string") {
      return splitAnswerPartsV2(obj.correct_answer_text);
    }
    return [];
  })();

  const score = Number.isFinite(Number(obj.score)) ? Number(obj.score) : 5;

  return {
    id: normalizeSpaces(obj.id || obj.question_id || obj.questionId || `q${index + 1}`),
    type: ["single", "multiple", "judge"].includes(obj.type) ? obj.type : "single",
    question: normalizeSpaces(obj.question || obj.text || obj.stem || ""),
    options,
    correct_answers: correctAnswers,
    score,
    explanation: normalizeSpaces(obj.explanation || ""),
  };
}

function normalizeTeacherBank(raw) {
  const root = Array.isArray(raw) ? { questions: raw } : isObject(raw) ? raw : { questions: [] };
  const rawQuestions = Array.isArray(root.questions) ? root.questions : [];
  return {
    quiz_id: normalizeSpaces(root.quiz_id || root.quizId || "test_001"),
    title: normalizeSpaces(root.title || "题库"),
    questions: rawQuestions.map((item, index) => normalizeTeacherQuestion(item, index)),
  };
}

function serializeTeacherQuestion(question) {
  const options = Array.isArray(question.options)
    ? question.options
        .map((option) => ({
          key: normalizeSpaces(option?.key || ""),
          content: normalizeSpaces(option?.content || ""),
        }))
        .filter((option) => option.key || option.content)
    : [];

  return {
    id: normalizeSpaces(question.id),
    type: ["single", "multiple", "judge"].includes(question.type) ? question.type : "single",
    question: normalizeSpaces(question.question),
    options,
    correct_answers: Array.isArray(question.correct_answers)
      ? question.correct_answers.map((item) => normalizeSpaces(item)).filter(Boolean)
      : splitAnswerPartsV2(question.correct_answer_text || ""),
    score: Number.isFinite(Number(question.score)) ? Number(question.score) : 5,
    explanation: normalizeSpaces(question.explanation || ""),
  };
}

function serializeTeacherBank(state) {
  return {
    quiz_id: normalizeSpaces(state.quiz_id || "test_001"),
    title: normalizeSpaces(state.title || "题库"),
    questions: Array.isArray(state.questions) ? state.questions.map((question) => serializeTeacherQuestion(question)) : [],
  };
}

function normalizeAnswer(value) {
  return normalizeSpaces(value)
    .replace(/[，、；;]/g, ",")
    .replace(/\s*,\s*/g, ",")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function normalizeJudgement(value) {
  const text = normalizeSpaces(value).toLowerCase();
  if (["正确", "对", "√", "true", "t", "yes", "y", "1"].includes(text)) return "正确";
  if (["错误", "错", "×", "false", "f", "no", "n", "0"].includes(text)) return "错误";
  return normalizeSpaces(value);
}

function compareAnswers(userText, correctText) {
  const user = normalizeAnswer(userText);
  const correct = normalizeAnswer(correctText);
  if (!user && !correct) return null;
  if (user === correct) return true;

  const userJudge = normalizeJudgement(userText);
  const correctJudge = normalizeJudgement(correctText);
  if (userJudge && correctJudge && userJudge === correctJudge) return true;

  return false;
}

function createEmptySession(id) {
  return {
    test_session_id: id,
    records: [],
  };
}

function splitAnswerPartsV2(value) {
  const cleaned = normalizeSpaces(value)
    .replace(/[，、；;]/g, ",")
    .replace(/\s+/g, "")
    .toUpperCase();
  if (!cleaned) return [];
  return cleaned.split(",").filter(Boolean);
}

function compareAnswersV2(userText, correctText) {
  const userParts = splitAnswerPartsV2(userText);
  const correctParts = splitAnswerPartsV2(correctText);
  if (!userParts.length && !correctParts.length) return null;

  const userJoined = userParts.slice().sort().join(",");
  const correctJoined = correctParts.slice().sort().join(",");
  if (userJoined && userJoined === correctJoined) return true;

  const userSingle = normalizeAnswer(userText);
  const correctSingle = normalizeAnswer(correctText);
  if (userSingle && userSingle === correctSingle) return true;

  const userJudge = normalizeJudgement(userText);
  const correctJudge = normalizeJudgement(correctText);
  if (userJudge && correctJudge && userJudge === correctJudge) return true;

  return false;
}

function isMultipleChoiceQuestion(question) {
  return String(question?.type || "").toLowerCase() === "multiple";
}

function getSelectedOptionKeys(answerText) {
  return new Set(splitAnswerPartsV2(answerText));
}

function toggleMultipleAnswer(currentValue, optionKey) {
  const normalizedKey = normalizeAnswer(optionKey);
  const parts = splitAnswerPartsV2(currentValue);
  const index = parts.indexOf(normalizedKey);
  if (index >= 0) {
    parts.splice(index, 1);
  } else {
    parts.push(normalizedKey);
  }
  return parts.join(",");
}

function getQuestionById(bank, questionId) {
  return bank?.questions?.find((item) => String(item.id) === String(questionId));
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
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return `test${next}`;
}

function ensureSessionHasAllRecords(session, bank) {
  const existing = new Map(
    Array.isArray(session.records)
      ? session.records.map((record) => [String(record.question_id), record])
      : []
  );
  const records = bank.questions.map((question) => {
    const previous = existing.get(String(question.id));
    const correctAnswerText = question.correct_answer_text || "";
    if (previous) {
      return {
        question_id: String(question.id),
        user_answer_text: normalizeSpaces(previous.user_answer_text || ""),
        correct_answer_text: normalizeSpaces(previous.correct_answer_text || correctAnswerText),
      };
    }
    return {
      question_id: String(question.id),
      user_answer_text: "",
      correct_answer_text: normalizeSpaces(correctAnswerText),
    };
  });
  return {
    test_session_id: session.test_session_id,
    records,
  };
}

function createRenderer() {
  const app = {
    bank: null,
    sessionsMeta: loadMeta(),
    activeSessionId: "",
    activeSession: null,
    showAnswers: false,
  };

  function persistActiveSession() {
    if (!app.activeSession) return;
    saveSession(app.activeSession);
    saveMeta(app.sessionsMeta);
  }

  function setActiveSession(sessionId) {
    persistActiveSession();
    app.activeSessionId = sessionId;
    const loaded = loadSession(sessionId);
    app.activeSession = app.bank ? ensureSessionHasAllRecords(loaded, app.bank) : loaded;
    saveSession(app.activeSession);
    app.sessionsMeta.activeId = sessionId;
    saveMeta(app.sessionsMeta);
    renderSessions();
    renderStats();
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
    saveMeta(app.sessionsMeta);
    const session = ensureSessionHasAllRecords(createEmptySession(newId), app.bank);
    saveSession(session);
    setActiveSession(newId);
  }

  function deleteSession(sessionId) {
    if (!confirm(`确定删除 ${sessionId} 吗？`)) return;
    localStorage.removeItem(getSessionKey(sessionId));
    app.sessionsMeta.sessions = app.sessionsMeta.sessions.filter((item) => item.id !== sessionId);
    if (app.sessionsMeta.activeId === sessionId) {
      app.sessionsMeta.activeId = app.sessionsMeta.sessions[0]?.id || "";
    }
    saveMeta(app.sessionsMeta);
    if (app.sessionsMeta.activeId) {
      setActiveSession(app.sessionsMeta.activeId);
    } else {
      app.activeSessionId = "";
      app.activeSession = null;
      renderSessions();
      renderStats();
      renderQuestions();
    }
  }

  function updateRecord(questionId, userAnswerText, shouldRender = true) {
    if (!app.activeSession || !app.bank) return;
    const session = ensureSessionHasAllRecords(app.activeSession, app.bank);
    const normalizedAnswer = normalizeSpaces(userAnswerText);
    const question = app.bank.questions.find((item) => String(item.id) === String(questionId));
    const correctAnswerText = question?.correct_answer_text || "";
    const record = session.records.find((item) => String(item.question_id) === String(questionId));
    if (record) {
      record.user_answer_text = normalizedAnswer;
      record.correct_answer_text = normalizeSpaces(correctAnswerText);
    }
    app.activeSession = session;
    saveSession(session);
    renderStats();
    if (shouldRender) {
      renderQuestions();
    }
  }

  function getRecord(questionId) {
    return app.activeSession?.records?.find((item) => String(item.question_id) === String(questionId));
  }

  function countAnswered() {
    return app.activeSession?.records?.filter((item) => normalizeSpaces(item.user_answer_text)).length || 0;
  }

  function countCorrect() {
    if (!app.activeSession) return 0;
    return app.activeSession.records.filter((record) => compareAnswersV2(record.user_answer_text, record.correct_answer_text)).length;
  }

  function renderSessions() {
    const list = document.getElementById("sessionList");
    if (!list) return;
    if (!app.sessionsMeta.sessions.length) {
      list.innerHTML = `<div class="notice">暂无测试记录，点击“新建测试”开始。</div>`;
      return;
    }

    list.innerHTML = app.sessionsMeta.sessions
      .map((session) => {
        const active = session.id === app.sessionsMeta.activeId ? "active" : "";
        const recordCount = app.activeSession?.records?.length || 0;
        return `
          <div class="session-item ${active}">
            <button class="btn btn-ghost session-switch" data-session="${escapeHtml(session.id)}" type="button">
              ${escapeHtml(session.id)}
            </button>
            <div class="session-name">${escapeHtml(session.name || session.id)}</div>
            <div class="mini-actions">
              <button class="icon-btn session-delete" data-session="${escapeHtml(session.id)}" type="button" title="删除测试">×</button>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderStats() {
    const totalEl = document.getElementById("statTotal");
    const answeredEl = document.getElementById("statAnswered");
    const correctEl = document.getElementById("statCorrect");
    const sessionNameEl = document.getElementById("activeSessionName");
    const importHint = document.getElementById("importHint");
    const questionCount = app.bank?.questions?.length || 0;
    const answered = countAnswered();
    const correct = countCorrect();
    if (totalEl) totalEl.textContent = String(questionCount);
    if (answeredEl) answeredEl.textContent = String(answered);
    if (correctEl) correctEl.textContent = String(correct);
    if (sessionNameEl) sessionNameEl.textContent = app.activeSessionId || "未选择";
    if (importHint && app.bank) {
      importHint.textContent = `${app.bank.title || "题库"} · ${questionCount} 题`;
    }
  }

  function renderQuestions() {
    const container = document.getElementById("questionList");
    if (!container) return;
    if (!app.bank) {
      container.innerHTML = "";
      return;
    }

    const questions = app.bank.questions;
    const html = questions
      .map((question, index) => {
        const record = getRecord(question.id) || {
          user_answer_text: "",
          correct_answer_text: question.correct_answer_text || "",
        };
        const evaluation = compareAnswersV2(record.user_answer_text, record.correct_answer_text);
        const statusClass =
          evaluation === null ? "badge-muted" : evaluation ? "badge-success" : "badge-danger";
        const statusText =
          evaluation === null ? "未作答" : evaluation ? "答案匹配" : "答案不一致";
        const selectedKeys = getSelectedOptionKeys(record.user_answer_text);
        const optionsHtml =
          question.options?.length
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

        const quickButtons =
          question.type === "judge"
            ? `
              <div class="answer-tools">
                <button type="button" class="btn btn-secondary quick-answer" data-value="正确" data-question-id="${escapeHtml(question.id)}">正确</button>
                <button type="button" class="btn btn-secondary quick-answer" data-value="错误" data-question-id="${escapeHtml(question.id)}">错误</button>
              </div>
            `
            : question.options?.length
              ? `
                <div class="answer-tools">
                  <button type="button" class="btn btn-secondary quick-answer" data-value="" data-question-id="${escapeHtml(question.id)}">清空答案</button>
                </div>
              `
              : "";

        const answerPreview = app.showAnswers
          ? `<div class="answer-preview"><strong>标准答案：</strong>${escapeHtml(record.correct_answer_text || "未配置")}</div>`
          : "";

        return `
          <article class="question-card ${question.question === "[空题]" ? "empty" : ""}" data-question-id="${escapeHtml(question.id)}">
            <div class="question-head">
              <div class="question-id">${escapeHtml(question.id)}</div>
              <div class="question-type">${escapeHtml(TYPE_LABELS[question.type] || question.type)}</div>
            </div>
            <div class="question-body">
              <p class="question-text">${escapeHtml(question.question)}</p>
              ${optionsHtml}
              <div class="answer-row">
                <label class="answer-input">
                  <span class="helper">学生作答文本</span>
                  <input type="text" class="user-answer" data-question-id="${escapeHtml(question.id)}" value="${escapeHtml(record.user_answer_text || "")}" placeholder="请输入答案文本" />
                </label>
                ${quickButtons}
                <div class="status-line">
                  <span class="badge ${statusClass}">${escapeHtml(statusText)}</span>
                  <button type="button" class="btn btn-ghost reveal-toggle" data-question-id="${escapeHtml(question.id)}">
                    ${app.showAnswers ? "隐藏答案" : "查看标准答案"}
                  </button>
                </div>
                ${answerPreview}
              </div>
            </div>
          </article>
        `;
      })
      .join("");

    container.innerHTML = html;
  }

  function mountEvents() {
    const fileInput = document.getElementById("importInput");
    const newSessionBtn = document.getElementById("newSessionBtn");
    const saveBtn = document.getElementById("saveBtn");
    const exportBtn = document.getElementById("exportBtn");
    const showAnswersBtn = document.getElementById("toggleAnswersBtn");

    fileInput?.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      const raw = safeJsonParse(text, null);
      if (!raw) {
        alert("JSON 文件解析失败，请检查格式。");
        return;
      }

      app.bank = normalizeQuestionBank(raw);
      app.sessionsMeta = loadMeta();
      if (!app.sessionsMeta.sessions.length) {
        const firstId = "test1";
        app.sessionsMeta.sessions = [{ id: firstId, name: firstId, createdAt: Date.now() }];
        app.sessionsMeta.activeId = firstId;
        saveMeta(app.sessionsMeta);
        saveSession(ensureSessionHasAllRecords(createEmptySession(firstId), app.bank));
      } else {
        app.sessionsMeta.activeId = app.sessionsMeta.activeId || app.sessionsMeta.sessions[0].id;
        saveMeta(app.sessionsMeta);
      }

      const activeId = app.sessionsMeta.activeId;
      app.activeSessionId = activeId;
      const loaded = loadSession(activeId);
      app.activeSession = ensureSessionHasAllRecords(loaded, app.bank);
      saveSession(app.activeSession);

      document.getElementById("studentApp")?.classList.remove("hidden");
      document.getElementById("importState")?.classList.add("hidden");
      document.getElementById("importedName").textContent = file.name;

      renderSessions();
      renderStats();
      renderQuestions();
    });

    newSessionBtn?.addEventListener("click", createSession);
    saveBtn?.addEventListener("click", () => {
      persistActiveSession();
      alert("已暂存到当前测试记录。");
    });
    exportBtn?.addEventListener("click", () => {
      if (!app.activeSession) return;
      downloadJson(`${app.activeSession.test_session_id}.json`, app.activeSession);
    });
    showAnswersBtn?.addEventListener("click", () => {
      app.showAnswers = !app.showAnswers;
      renderQuestions();
    });

    document.getElementById("sessionList")?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const sessionId = target.getAttribute("data-session");
      if (!sessionId) return;
      if (target.classList.contains("session-switch")) {
        if (sessionId !== app.activeSessionId) setActiveSession(sessionId);
      }
      if (target.classList.contains("session-delete")) {
        deleteSession(sessionId);
      }
    });

    document.getElementById("questionList")?.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (!target.classList.contains("user-answer")) return;
      updateRecord(target.dataset.questionId, target.value, false);
    });

    document.getElementById("questionList")?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const questionId = target.dataset.questionId;
      if (!questionId) return;

      if (target.classList.contains("option-item") || target.classList.contains("quick-answer")) {
        const value = target.dataset.pick || target.dataset.value || "";
        const question = getQuestionById(app.bank, questionId);
        const currentRecord = getRecord(questionId);

        if (target.classList.contains("option-item") && isMultipleChoiceQuestion(question)) {
          const toggled = toggleMultipleAnswer(currentRecord?.user_answer_text || "", value);
          updateRecord(questionId, toggled);
        } else {
          updateRecord(questionId, value);
        }
      }

      if (target.classList.contains("reveal-toggle")) {
        app.showAnswers = !app.showAnswers;
        renderQuestions();
      }
    });

    window.addEventListener("beforeunload", persistActiveSession);
  }

  function bootstrapTeacher() {
    const appRoot = document.getElementById("teacherApp");
    if (!appRoot) return;
    const state = {
      questions: [
        {
          id: "q1",
          type: "single",
          question: "",
          options: [
            { key: "A", content: "" },
            { key: "B", content: "" },
          ],
          correct_answer_text: "",
        },
      ],
    };

    const list = document.getElementById("teacherQuestionList");
    const titleInput = document.getElementById("teacherTitle");

    function addQuestion(defaultType = "single") {
      const nextIndex = state.questions.length + 1;
      const options =
        defaultType === "judge"
          ? []
          : [
              { key: "A", content: "" },
              { key: "B", content: "" },
              { key: "C", content: "" },
              { key: "D", content: "" },
            ];
      state.questions.push({
        id: `q${nextIndex}`,
        type: defaultType,
        question: "",
        options,
        correct_answer_text: "",
      });
      renderTeacher();
    }

    function removeQuestion(index) {
      state.questions.splice(index, 1);
      renderTeacher();
    }

    function updateQuestion(index, field, value) {
      state.questions[index][field] = value;
    }

    function updateOption(questionIndex, optionIndex, field, value) {
      state.questions[questionIndex].options[optionIndex][field] = value;
    }

    function addOption(questionIndex) {
      const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const nextKey = letters[state.questions[questionIndex].options.length] || `O${state.questions[questionIndex].options.length + 1}`;
      state.questions[questionIndex].options.push({ key: nextKey, content: "" });
      renderTeacher();
    }

    function removeOption(questionIndex, optionIndex) {
      state.questions[questionIndex].options.splice(optionIndex, 1);
      renderTeacher();
    }

    function renderTeacher() {
      list.innerHTML = state.questions
        .map((question, index) => {
          const optionsHtml =
            question.type === "judge"
              ? `<div class="notice">判断题无需配置选项。</div>`
              : `
                <div class="options-wrap">
                  ${question.options
                    .map(
                      (option, optionIndex) => `
                        <div class="option-editor">
                          <input type="text" class="teacher-option-key" data-qindex="${index}" data-oindex="${optionIndex}" value="${escapeHtml(option.key)}" placeholder="选项" />
                          <input type="text" class="teacher-option-content" data-qindex="${index}" data-oindex="${optionIndex}" value="${escapeHtml(option.content)}" placeholder="选项内容" />
                          <button type="button" class="icon-btn remove-option" data-qindex="${index}" data-oindex="${optionIndex}" title="删除选项">×</button>
                        </div>
                      `
                    )
                    .join("")}
                  <button type="button" class="btn btn-secondary add-option" data-qindex="${index}">添加选项</button>
                </div>
              `;

          return `
            <section class="question-card teacher-card" data-qindex="${index}">
              <div class="card-top">
                <div class="inline-actions">
                  <span class="badge badge-muted">题目 ${index + 1}</span>
                  <button type="button" class="btn btn-ghost remove-question" data-qindex="${index}">删除</button>
                </div>
                <div class="inline-actions">
                  <select class="teacher-type" data-qindex="${index}">
                    <option value="single" ${question.type === "single" ? "selected" : ""}>单选题</option>
                    <option value="multiple" ${question.type === "multiple" ? "selected" : ""}>多选题</option>
                    <option value="judge" ${question.type === "judge" ? "selected" : ""}>判断题</option>
                  </select>
                </div>
              </div>
              <div class="field-grid">
                <label class="field-block">
                  <span class="helper">题号 ID</span>
                  <input type="text" class="teacher-id" data-qindex="${index}" value="${escapeHtml(question.id)}" />
                </label>
                <label class="field-block" style="grid-column: span 2;">
                  <span class="helper">题目文本</span>
                  <textarea class="teacher-question" data-qindex="${index}" placeholder="输入题目正文">${escapeHtml(question.question)}</textarea>
                </label>
              </div>
              <div class="field-block" style="margin-top: 12px;">
                <span class="helper">正确答案文本</span>
                <input type="text" class="teacher-correct" data-qindex="${index}" value="${escapeHtml(question.correct_answer_text || "")}" placeholder="例如：A、无产阶级" />
              </div>
              <div class="field-block" style="margin-top: 12px;">
                <span class="helper">选项配置</span>
                ${optionsHtml}
              </div>
            </section>
          `;
        })
        .join("");
    }

    appRoot.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.id === "addQuestionBtn") {
        addQuestion();
        return;
      }
      if (target.id === "exportTeacherBtn") {
        const title = normalizeSpaces(titleInput?.value || "题库");
        const payload = {
          quiz_id: "test_001",
          title,
          questions: state.questions.map((question) => ({
            id: normalizeSpaces(question.id),
            type: question.type,
            question: normalizeSpaces(question.question),
            options: Array.isArray(question.options)
              ? question.options.map((option) => ({
                  key: normalizeSpaces(option.key),
                  content: normalizeSpaces(option.content),
                }))
              : [],
            correct_answer_text: normalizeSpaces(question.correct_answer_text),
          })),
        };
        downloadJson("data-ans.json", payload);
        return;
      }

      if (target.classList.contains("remove-question")) {
        removeQuestion(Number(target.dataset.qindex));
        return;
      }
      if (target.classList.contains("add-option")) {
        addOption(Number(target.dataset.qindex));
        return;
      }
      if (target.classList.contains("remove-option")) {
        removeOption(Number(target.dataset.qindex), Number(target.dataset.oindex));
      }
    });

    appRoot.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const qindex = Number(target.dataset.qindex);
      if (Number.isNaN(qindex)) return;

      if (target.classList.contains("teacher-id")) {
        updateQuestion(qindex, "id", target.value);
      } else if (target.classList.contains("teacher-question")) {
        updateQuestion(qindex, "question", target.value);
      } else if (target.classList.contains("teacher-correct")) {
        updateQuestion(qindex, "correct_answer_text", target.value);
      } else if (target.classList.contains("teacher-type")) {
        const type = target.value;
        updateQuestion(qindex, "type", type);
        if (type === "judge") {
          state.questions[qindex].options = [];
        } else if (!Array.isArray(state.questions[qindex].options) || !state.questions[qindex].options.length) {
          state.questions[qindex].options = [
            { key: "A", content: "" },
            { key: "B", content: "" },
            { key: "C", content: "" },
            { key: "D", content: "" },
          ];
        }
        renderTeacher();
      } else if (target.classList.contains("teacher-option-key")) {
        updateOption(qindex, Number(target.dataset.oindex), "key", target.value);
      } else if (target.classList.contains("teacher-option-content")) {
        updateOption(qindex, Number(target.dataset.oindex), "content", target.value);
      }
    });

    document.getElementById("addDefaultQuestionBtn")?.addEventListener("click", () => addQuestion("single"));
    renderTeacher();
  }

  function bootstrapStudent() {
    if (document.getElementById("studentApp")) {
      mountEvents();
      renderSessions();
      renderStats();
      renderQuestions();
    }
  }

  return {
    bootstrapTeacher,
    bootstrapStudent,
  };
}

window.QuizApp = createRenderer();
