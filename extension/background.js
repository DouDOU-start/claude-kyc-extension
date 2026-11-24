const appURL = chrome.runtime.getURL("app.html");

async function openApp() {
  if (chrome.runtime.getContexts) {
    try {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ["TAB"],
        documentUrls: [appURL],
      });
      const current = contexts.find((context) => Number.isInteger(context.tabId) && context.tabId >= 0);
      if (current) {
        await chrome.tabs.update(current.tabId, { active: true });
        return;
      }
    } catch {}
  }
  await chrome.tabs.create({ url: appURL });
}

chrome.action.onClicked.addListener(() => {
  void openApp();
});
