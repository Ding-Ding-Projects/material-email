export type IconName =
  | "account"
  | "archive"
  | "attach"
  | "back"
  | "calendar"
  | "check"
  | "chevron"
  | "close"
  | "compose"
  | "download"
  | "edit"
  | "error"
  | "folder"
  | "forward"
  | "history"
  | "inbox"
  | "info"
  | "mail"
  | "menu"
  | "more"
  | "notifications"
  | "pin"
  | "refresh"
  | "regex"
  | "reply"
  | "search"
  | "send"
  | "settings"
  | "star"
  | "tasks"
  | "tools"
  | "trash"
  | "unread"
  | "warning";

const paths: Record<IconName, string> = {
  account: '<circle cx="12" cy="8" r="3.5"/><path d="M5.5 20c.4-4.1 2.6-6.2 6.5-6.2s6.1 2.1 6.5 6.2"/>',
  archive: '<path d="M4 7h16v13H4zM3 3h18v4H3zM9 11h6"/>',
  attach: '<path d="m8.2 12.8 6.5-6.5a3 3 0 0 1 4.2 4.2l-8.1 8.1a5 5 0 0 1-7.1-7.1l8-8M7.5 15.5l7.3-7.3"/>',
  back: '<path d="m14.5 5-7 7 7 7"/>',
  calendar: '<path d="M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Zm2-2v4m10-4v4M3 9h18"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  chevron: '<path d="m7 9 5 5 5-5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  compose: '<path d="M4 20h4l11-11-4-4L4 16v4Zm9-13 4 4M4 4h7"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 20h16"/>',
  edit: '<path d="m4 16 12-12 4 4L8 20H4v-4Zm10-10 4 4"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/>',
  folder: '<path d="M3 6h7l2 2h9v11H3z"/>',
  forward: '<path d="m13 6 6 6-6 6v-4c-5 0-8 1-10 4 1-6 4-9 10-9V6Z"/>',
  history: '<path d="M4 5v5h5M5 9a8 8 0 1 1-1 5M12 8v5l3 2"/>',
  inbox: '<path d="M4 4h16v16H4zM4 14h5l2 3h2l2-3h5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  more: '<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
  notifications: '<path d="M6 17h12l-1.5-2.5V10a4.5 4.5 0 0 0-9 0v4.5L6 17Zm4 3h4"/>',
  pin: '<path d="m8 3 8 8-2 2 3 4-1 1-4-3-2 2-8-8 2-2 4 2 2-2-2-4Z"/>',
  refresh: '<path d="M20 6v5h-5M4 18v-5h5M18.5 10a7 7 0 0 0-12-3L4 11m16 2-2.5 4a7 7 0 0 1-12-3"/>',
  regex: '<path d="M5 6v9a3 3 0 0 0 3 3h1m3-12 7 12m0-12-7 12M4 5h5"/>',
  reply: '<path d="m11 6-7 6 7 6v-4c5 0 8 1 10 4-1-6-4-9-10-9V6Z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
  send: '<path d="M3 4 21 12 3 20l3-7 9-1-9-1-3-7Z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7-.5-1.2.9-1.9-2.1-2.1-1.9.9-1.2-.5-.7-2h-3l-.7 2-1.2.5-1.9-.9L2.6 6.7l.9 1.9L3 9.8l-2 .7v3l2 .7.5 1.2-.9 1.9 2.1 2.1 1.9-.9 1.2.5.7 2h3l.7-2 1.2-.5 1.9.9 2.1-2.1-.9-1.9.5-1.2 2-.7Z"/>',
  star: '<path d="m12 3 2.8 5.6 6.2.9-4.5 4.4 1.1 6.1-5.6-2.9L6.4 20l1.1-6.1L3 9.5l6.2-.9L12 3Z"/>',
  tasks: '<path d="M9 6h11M9 12h11M9 18h11M3.5 6l1.2 1.2L7 4.8M3.5 12l1.2 1.2L7 10.8M3.5 18l1.2 1.2L7 16.8"/>',
  tools: '<path d="m14.5 5.5 4-2-2 4 2 2 3.5-2a6 6 0 0 1-7.5 7.5L8 21.5 2.5 16l6.5-6.5a6 6 0 0 1 7.5-7.5l-2 3.5Z"/>',
  trash: '<path d="M4 7h16M9 3h6l1 4H8l1-4Zm-3 4 1 14h10l1-14M10 11v6m4-6v6"/>',
  unread: '<path d="M3 6h18v13H3zM4 8l8 6 8-6"/><circle cx="19" cy="5" r="3" fill="currentColor"/>',
  warning: '<path d="M12 3 2.5 20h19L12 3Zm0 6v5m0 3h.01"/>',
};

export const icon = (name: IconName, className = ""): string =>
  `<svg class="icon ${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
