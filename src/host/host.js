// Host page script: a real site returns the access token of its signed-in user here.
// The journeys put the Zitadel access token in window.__e2eUserToken with an init script;
// a signed-out page has none, so the widget shows its sign-in view.
const token = window.__e2eUserToken;
for (const widget of document.querySelectorAll("synthwerk-chat, synthwerk-vision")) {
  if (typeof token === "string" && token !== "") {
    widget.getUserToken = () => token;
    widget.refreshSession?.();
  }
}
