(() => {
  const DRAFT_KEY = "teacher_qna_draft_v1";
  const PAGE_SIZE = 50;

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

  const splitAnswers = (value) =>
    normalizeSpaces(value)
      .replace(/[，、；;]/g, ",")
      .replace(/\s+/g, "")
      .toUpperCase()
      .split(",")
      .map((item) => normalizeSpaces(item))
      .filter(Boolean);

  const normalizeAnswerKey = (value) => normalizeSpaces(value).toUpperCase();

  function getAnswerSet(question) {
    return new Set(
      Array.isArray(question?.correct_answers)
        ? question.correct_answers.map((item) => normalizeAnswerKey(item)).filter(Boolean)
        : []
    );
  }

  function toggleAnswer(question, answerKey) {
    const key = normalizeAnswerKey(answerKey);
    const next = new Set(getAnswerSet(question));
    if (next.has(key)) {
      next.delete(key);
    } else {
      if (question.type === "single" || question.type === "judge") {
        next.clear();
      }
      next.add(key);
    }
    question.correct_answers = Array.from(next);
  }

  function setSingleAnswer(question, answerKey) {
    question.correct_answers = [normalizeAnswerKey(answerKey)];
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

    return {
      id: normalizeSpaces(obj.id || obj.question_id || obj.questionId || `q${index + 1}`),
      type: ["single", "multiple", "judge"].includes(obj.type) ? obj.type : "single",
      question: normalizeSpaces(obj.question || obj.text || obj.stem || ""),
      options,
      correct_answers: Array.isArray(obj.correct_answers)
        ? obj.correct_answers.map((item) => normalizeSpaces(item)).filter(Boolean)
        : typeof obj.correct_answer_text === "string"
          ? splitAnswers(obj.correct_answer_text)
          : [],
      score: Number.isFinite(Number(obj.score)) ? Number(obj.score) : 5,
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

  function serializeTeacherBank(state) {
    return {
      quiz_id: normalizeSpaces(state.quiz_id || "test_001"),
      title: normalizeSpaces(state.title || "题库"),
      questions: state.questions.map((question) => ({
        id: normalizeSpaces(question.id),
        type: ["single", "multiple", "judge"].includes(question.type) ? question.type : "single",
        question: normalizeSpaces(question.question),
        options: Array.isArray(question.options)
          ? question.options
              .map((option) => ({
                key: normalizeSpaces(option?.key || ""),
                content: normalizeSpaces(option?.content || ""),
              }))
              .filter((option) => option.key || option.content)
          : [],
        correct_answers: Array.isArray(question.correct_answers)
          ? question.correct_answers.map((item) => normalizeSpaces(item)).filter(Boolean)
          : [],
        score: Number.isFinite(Number(question.score)) ? Number(question.score) : 5,
        explanation: normalizeSpaces(question.explanation || ""),
      })),
    };
  }

  function createBlankQuestion(index = 0, type = "single") {
    return normalizeTeacherQuestion(
      {
        id: `q${index + 1}`,
        type,
        question: "",
        options:
          type === "judge"
            ? []
            : [
                { key: "A", content: "" },
                { key: "B", content: "" },
                { key: "C", content: "" },
                { key: "D", content: "" },
              ],
        correct_answers: [],
        score: 5,
        explanation: "",
      },
      index
    );
  }

  function bootstrap() {
    const root = document.getElementById("teacherApp");
    if (!root) return;

    const list = document.getElementById("teacherQuestionList");
    const titleInput = document.getElementById("teacherTitle");
    const fileInput = document.getElementById("teacherFileInput");
    const statusEl = document.getElementById("teacherStatus");
    const pagerEl = document.getElementById("teacherPager");

    const state = {
      quiz_id: "test_001",
      title: "自定义题库",
      questions: [createBlankQuestion(0)],
      currentPage: 1,
      fileHandle: null,
      sourceName: "data-qna.json",
      dirty: false,
      draftSavedAt: 0,
      fileSavedAt: 0,
    };

    function getTotalPages() {
      return Math.max(1, Math.ceil(state.questions.length / PAGE_SIZE));
    }

    function clampPage(page) {
      return Math.min(Math.max(1, page), getTotalPages());
    }

    function nextQuestionId() {
      const nums = state.questions
        .map((item) => /^q(\d+)$/i.exec(String(item.id || ""))?.[1])
        .filter(Boolean)
        .map(Number);
      return `q${nums.length ? Math.max(...nums) + 1 : state.questions.length + 1}`;
    }

    function setStatus(message) {
      if (!statusEl) return;
      const parts = [message].filter(Boolean);
      parts.push(`题目 ${state.questions.length} 条`);
      parts.push(`第 ${clampPage(state.currentPage)}/${getTotalPages()} 页`);
      if (state.sourceName) parts.push(`来源 ${state.sourceName}`);
      if (state.dirty) parts.push("未写回文件");
      statusEl.textContent = parts.join(" · ");
    }

    function markDirty(message = "已修改") {
      state.dirty = true;
      setStatus(message);
    }

    function markSaved(kind, message) {
      state.dirty = false;
      const now = Date.now();
      if (kind === "draft") state.draftSavedAt = now;
      if (kind === "file") state.fileSavedAt = now;
      setStatus(message);
    }

    function loadDraft() {
      const draft = safeJsonParse(localStorage.getItem(DRAFT_KEY), null);
      if (!draft) return false;
      const bank = normalizeTeacherBank(draft);
      state.quiz_id = bank.quiz_id;
      state.title = bank.title;
      state.questions = bank.questions.length ? bank.questions : [createBlankQuestion(0)];
      state.currentPage = 1;
      state.sourceName = draft.source_name || "本地草稿";
      state.dirty = false;
      if (titleInput) titleInput.value = state.title;
      return true;
    }

    function applyBank(raw, options = {}) {
      const bank = normalizeTeacherBank(raw);
      state.quiz_id = bank.quiz_id;
      state.title = bank.title;
      state.questions = bank.questions.length ? bank.questions : [createBlankQuestion(0)];
      state.currentPage = 1;
      state.fileHandle = options.fileHandle ?? state.fileHandle;
      state.sourceName = options.sourceName || state.sourceName || "data-qna.json";
      state.dirty = false;
      if (titleInput) titleInput.value = state.title;
      render();
      setStatus(options.message || `已载入 ${state.sourceName}`);
    }

    function persistDraft() {
      const payload = {
        ...serializeTeacherBank(state),
        source_name: state.sourceName,
        saved_at: Date.now(),
      };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
      markSaved("draft", "已临时保存到本地草稿");
    }

    async function writeFile(handle) {
      const targetHandle = handle || state.fileHandle;
      if (!targetHandle || typeof targetHandle.createWritable !== "function") return false;
      const writable = await targetHandle.createWritable();
      await writable.write(JSON.stringify(serializeTeacherBank(state), null, 2));
      await writable.close();
      state.fileHandle = targetHandle;
      markSaved("file", `已写回 ${state.sourceName || "data-qna.json"}`);
      return true;
    }

    async function saveToFile() {
      try {
        if (state.fileHandle) {
          await writeFile(state.fileHandle);
          return;
        }

        if (window.showSaveFilePicker) {
          const handle = await window.showSaveFilePicker({
            suggestedName: "data-qna.json",
            types: [
              {
                description: "JSON 文件",
                accept: { "application/json": [".json"] },
              },
            ],
          });
          state.sourceName = "data-qna.json";
          await writeFile(handle);
          return;
        }

        downloadJson("data-qna.json", serializeTeacherBank(state));
        markSaved("file", "已下载 data-qna.json 副本");
      } catch (error) {
        console.error(error);
        alert("保存失败，请改用浏览器下载备份，或先通过“打开 data-qna.json”建立文件句柄。");
      }
    }

    async function openFile() {
      try {
        if (window.showOpenFilePicker) {
          const [handle] = await window.showOpenFilePicker({
            multiple: false,
            types: [
              {
                description: "JSON 文件",
                accept: { "application/json": [".json"] },
              },
            ],
          });
          const file = await handle.getFile();
          const raw = safeJsonParse(await file.text(), null);
          if (!raw) {
            alert("JSON 解析失败，请检查文件格式。");
            return;
          }
          state.fileHandle = handle;
          state.sourceName = file.name || "data-qna.json";
          applyBank(raw, { fileHandle: handle, sourceName: state.sourceName, message: `已打开 ${state.sourceName}` });
          return;
        }

        fileInput?.click();
      } catch (error) {
        console.error(error);
      }
    }

    function addQuestion(defaultType = "single") {
      state.questions.push(
        normalizeTeacherQuestion(
          {
            id: nextQuestionId(),
            type: defaultType,
            question: "",
            options:
              defaultType === "judge"
                ? []
                : [
                    { key: "A", content: "" },
                    { key: "B", content: "" },
                    { key: "C", content: "" },
                    { key: "D", content: "" },
                  ],
            correct_answers: [],
            score: 5,
            explanation: "",
          },
          state.questions.length
        )
      );
      state.currentPage = getTotalPages();
      markDirty("已新增题目");
      render();
    }

    function removeQuestion(index) {
      state.questions.splice(index, 1);
      if (!state.questions.length) {
        state.questions.push(createBlankQuestion(0));
      }
      state.currentPage = clampPage(state.currentPage);
      markDirty("已删除题目");
      render();
    }

    function updateQuestion(index, field, value) {
      const question = state.questions[index];
      if (!question) return;
      question[field] = value;
      markDirty(`已更新题目 ${index + 1}`);
    }

    function updateOption(questionIndex, optionIndex, field, value) {
      const question = state.questions[questionIndex];
      if (!question || !Array.isArray(question.options) || !question.options[optionIndex]) return;
      question.options[optionIndex][field] = value;
      markDirty("已更新选项");
    }

    function addOption(questionIndex) {
      const question = state.questions[questionIndex];
      if (!question) return;
      const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const nextKey = letters[question.options.length] || `O${question.options.length + 1}`;
      question.options.push({ key: nextKey, content: "" });
      markDirty("已新增选项");
      render();
    }

    function removeOption(questionIndex, optionIndex) {
      const question = state.questions[questionIndex];
      if (!question || !Array.isArray(question.options)) return;
      question.options.splice(optionIndex, 1);
      markDirty("已删除选项");
      render();
    }

    function renderPager() {
      if (!pagerEl) return;
      const totalPages = getTotalPages();
      const currentPage = clampPage(state.currentPage);
      const start = Math.max(1, currentPage - 2);
      const end = Math.min(totalPages, currentPage + 2);
      const buttons = [];

      buttons.push(
        `<button type="button" class="btn btn-ghost teacher-page-btn" data-page="${Math.max(1, currentPage - 1)}" ${currentPage === 1 ? "disabled" : ""}>上一页</button>`
      );
      for (let page = start; page <= end; page += 1) {
        buttons.push(
          `<button type="button" class="btn ${page === currentPage ? "btn-primary" : "btn-secondary"} teacher-page-btn" data-page="${page}">${page}</button>`
        );
      }
      buttons.push(
        `<button type="button" class="btn btn-ghost teacher-page-btn" data-page="${Math.min(totalPages, currentPage + 1)}" ${currentPage === totalPages ? "disabled" : ""}>下一页</button>`
      );

      pagerEl.innerHTML = `
        <div class="pager-group">${buttons.join("")}</div>
        <span class="pager-info">共 ${state.questions.length} 题，每页 ${PAGE_SIZE} 题，当前第 ${currentPage}/${totalPages} 页</span>
      `;
    }

    function render() {
      renderPager();
      if (titleInput) titleInput.value = state.title;
      if (!list) return;

      const page = clampPage(state.currentPage);
      state.currentPage = page;
      const start = (page - 1) * PAGE_SIZE;
      const pageQuestions = state.questions.slice(start, start + PAGE_SIZE);

      list.innerHTML = pageQuestions
        .map((question, offset) => {
          const index = start + offset;
          const answerSet = getAnswerSet(question);
          const optionKeys =
            question.type === "judge"
              ? [
                  { key: "正确", label: "正确" },
                  { key: "错误", label: "错误" },
                ]
              : Array.isArray(question.options) && question.options.length
                ? question.options.map((option) => ({
                    key: normalizeSpaces(option.key),
                    label: normalizeSpaces(option.key) || "选项",
                  }))
                : [];
          const optionsHtml =
            question.type === "judge"
              ? `<div class="notice">判断题不需要配置选项。</div>`
              : `
                <div class="options-wrap">
                  ${Array.isArray(question.options)
                    ? question.options
                        .map(
                          (option, optionIndex) => `
                            <div class="option-editor">
                              <input type="text" class="teacher-option-key" data-qindex="${index}" data-oindex="${optionIndex}" value="${escapeHtml(option.key)}" placeholder="选项" />
                              <input type="text" class="teacher-option-content" data-qindex="${index}" data-oindex="${optionIndex}" value="${escapeHtml(option.content)}" placeholder="选项内容" />
                              <button type="button" class="icon-btn remove-option" data-qindex="${index}" data-oindex="${optionIndex}" title="删除选项">×</button>
                            </div>
                          `
                        )
                        .join("")
                    : ""}
                  <button type="button" class="btn btn-secondary add-option" data-qindex="${index}">添加选项</button>
                </div>
              `;
          const answerPickerHtml = optionKeys.length
            ? `
              <div class="answer-picker">
                ${optionKeys
                  .map(
                    (option) => `
                      <button
                        type="button"
                        class="answer-choice ${answerSet.has(normalizeAnswerKey(option.key)) ? "selected" : ""}"
                        data-qindex="${index}"
                        data-answer-key="${escapeHtml(option.key)}"
                      >
                        <span class="answer-box"></span>
                        <span class="answer-label">${escapeHtml(option.label)}</span>
                      </button>
                    `
                  )
                  .join("")}
                <button type="button" class="btn btn-ghost clear-answer" data-qindex="${index}">清空</button>
              </div>
            `
            : `<div class="notice">先添加选项后，再选择标准答案。</div>`;

          return `
            <section class="question-card teacher-card" data-qindex="${index}">
              <div class="card-top">
                <div class="inline-actions">
                  <span class="badge badge-muted">#${index + 1}</span>
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
                <label class="field-block">
                  <span class="helper">分值</span>
                  <input type="number" class="teacher-score" data-qindex="${index}" min="0" step="1" value="${escapeHtml(question.score ?? 5)}" />
                </label>
                <label class="field-block" style="grid-column: 1 / -1;">
                  <span class="helper">题目文本</span>
                  <textarea class="teacher-question" data-qindex="${index}" placeholder="输入题目正文">${escapeHtml(question.question)}</textarea>
                </label>
                <label class="field-block" style="grid-column: 1 / -1;">
                  <span class="helper">解析说明</span>
                  <textarea class="teacher-explanation" data-qindex="${index}" placeholder="可选">${escapeHtml(question.explanation || "")}</textarea>
                </label>
                <div class="field-block" style="grid-column: 1 / -1;">
                  <span class="helper">标准答案选择</span>
                  ${answerPickerHtml}
                </div>
                <div class="field-block" style="grid-column: 1 / -1;">
                  <span class="helper">选项配置</span>
                  ${optionsHtml}
                </div>
              </div>
            </section>
          `;
        })
        .join("");

      setStatus("已准备编辑");
    }

    async function autoSave() {
      if (!state.dirty) return;
      persistDraft();
      if (state.fileHandle) {
        try {
          await writeFile(state.fileHandle);
        } catch (error) {
          console.error(error);
        }
      }
    }

    if (!loadDraft()) {
      state.questions = [createBlankQuestion(0)];
      state.title = "自定义题库";
      if (titleInput) titleInput.value = state.title;
    }

    render();
    setStatus("已准备就绪");

    root.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      if (target.id === "openTeacherBtn") {
        await openFile();
        return;
      }
      if (target.id === "draftTeacherBtn") {
        persistDraft();
        return;
      }
      if (target.id === "saveTeacherBtn") {
        await saveToFile();
        return;
      }
      if (target.id === "addQuestionBtn") {
        addQuestion("single");
        return;
      }
      if (target.id === "exportTeacherBtn") {
        downloadJson("data-qna-copy.json", serializeTeacherBank(state));
        setStatus("已导出 data-qna-copy.json");
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
        return;
      }
      if (target.classList.contains("teacher-page-btn")) {
        state.currentPage = clampPage(Number(target.dataset.page));
        render();
        return;
      }
      const answerChoice = target.closest?.(".answer-choice");
      if (answerChoice instanceof HTMLElement) {
        const qindex = Number(answerChoice.dataset.qindex);
        const question = state.questions[qindex];
        if (!question) return;
        const answerKey = answerChoice.dataset.answerKey || "";
        if (question.type === "single" || question.type === "judge") {
          setSingleAnswer(question, answerKey);
        } else {
          toggleAnswer(question, answerKey);
        }
        markDirty("标准答案已更新");
        render();
        return;
      }
      if (target.classList.contains("clear-answer")) {
        const qindex = Number(target.dataset.qindex);
        if (!state.questions[qindex]) return;
        state.questions[qindex].correct_answers = [];
        markDirty("标准答案已清空");
        render();
      }
    });

    root.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      if (target.id === "teacherTitle") {
        state.title = target.value;
        markDirty("题库标题已更新");
        return;
      }

      const qindex = Number(target.dataset.qindex);
      if (Number.isNaN(qindex)) return;

      if (target.classList.contains("teacher-id")) {
        updateQuestion(qindex, "id", target.value);
      } else if (target.classList.contains("teacher-question")) {
        updateQuestion(qindex, "question", target.value);
      } else if (target.classList.contains("teacher-correct")) {
        state.questions[qindex].correct_answers = splitAnswers(target.value);
        markDirty("正确答案已更新");
      } else if (target.classList.contains("teacher-explanation")) {
        updateQuestion(qindex, "explanation", target.value);
      } else if (target.classList.contains("teacher-score")) {
        updateQuestion(qindex, "score", Number(target.value) || 0);
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
        render();
      } else if (target.classList.contains("teacher-option-key")) {
        updateOption(qindex, Number(target.dataset.oindex), "key", target.value);
      } else if (target.classList.contains("teacher-option-content")) {
        updateOption(qindex, Number(target.dataset.oindex), "content", target.value);
      }
    });

    root.addEventListener("change", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.id === "teacherFileInput") {
        const file = target.files?.[0];
        if (!file) return;
        const raw = safeJsonParse(await file.text(), null);
        if (!raw) {
          alert("JSON 解析失败，请检查文件格式。");
          return;
        }
        state.fileHandle = null;
        state.sourceName = file.name || "data-qna.json";
        applyBank(raw, { sourceName: state.sourceName, message: `已导入 ${state.sourceName}` });
      }
    });

    window.addEventListener("beforeunload", () => {
      if (state.dirty) persistDraft();
    });

    window.setInterval(() => {
      void autoSave();
    }, 60000);
  }

  window.TeacherApp = {
    bootstrap,
  };
})();
