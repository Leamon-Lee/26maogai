(() => {
  const PASSWORD = "leamonlee04";
  const STORAGE_KEY = "quiz_access_granted_v1";

  try {
    if (localStorage.getItem(STORAGE_KEY) === "1") {
      return;
    }
  } catch {
    // If storage is unavailable, fall back to prompting on every load.
  }

  while (true) {
    const entered = window.prompt("请输入访问密码，密码获取添加 QQ：3051490681");
    if (entered === null) {
      window.alert("需要输入访问密码后才能继续访问。密码获取添加 QQ：3051490681");
      continue;
    }
    if (String(entered).trim() === PASSWORD) {
      try {
        localStorage.setItem(STORAGE_KEY, "1");
      } catch {
        // Ignore storage failures and continue.
      }
      break;
    }
    window.alert("密码错误，请重试。密码获取添加 QQ：3051490681");
  }
})();
