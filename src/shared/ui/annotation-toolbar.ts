export const ANNOTATION_TOOLBAR_ICONS = {
  select: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg>`,
  rect: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`,
  arrow: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="5" y1="19" x2="19" y2="5"/><polyline points="12 5 19 5 19 12"/></svg>`,
  privacy: `<svg width="15" height="15" viewBox="0 0 1024 1024" fill="currentColor"><path d="M7.13007408 512v252.43496297h252.43496295V512H7.13007408z m252.43496295 504.86992592H512v-252.43496295H259.56503703v252.43496295z m757.30488889 0v-252.43496295h-252.43496295v252.43496295h252.43496295zM7.13007408 7.13007408v252.43496295h252.43496295V7.13007408H7.13007408zM512 512v252.43496297h252.43496297V512H512z m0-252.43496297H259.56503703V512H512V259.56503703z m252.43496297-252.43496295H512v252.43496295h252.43496297V7.13007408zM1016.86992592 512V259.56503703h-252.43496295V512h252.43496295z"></path></svg>`,
  text: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="9" y1="20" x2="15" y2="20"/></svg>`,
  styleAdjust: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0l12.6 12.6z"/><line x1="14.5" y1="12.5" x2="16.5" y2="10.5"/><line x1="11.5" y1="9.5" x2="13.5" y2="7.5"/><line x1="8.5" y1="6.5" x2="10.5" y2="4.5"/><line x1="17.5" y1="15.5" x2="19.5" y2="13.5"/></svg>`,
  pruningToggle: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
  undo: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path></svg>`,
  redo: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"></path><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"></path></svg>`,
  clear: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
  reselect: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>`,
  cancel: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  confirm: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`,
};

export const ANNOTATION_TOOLBAR_CSS = `
  .toolbar {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 2px;
    background: rgba(35, 35, 35, 0.95);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    padding: 4px 6px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    user-select: none;
    z-index: 10;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .toolbar .divider {
    width: 1px;
    height: 14px;
    background: rgba(255, 255, 255, 0.12);
    margin: 0 4px;
  }
  .toolbar button {
    background: transparent;
    border: none;
    color: #d8d8d8;
    width: 28px;
    height: 28px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.12s ease;
    outline: none;
    padding: 0;
  }
  .toolbar button:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.12);
    color: #ffffff;
  }
  .toolbar button.active {
    background: rgba(250, 82, 82, 0.2);
    color: #FA5252;
  }
  .toolbar button:disabled {
    color: rgba(255, 255, 255, 0.2);
    cursor: not-allowed;
  }
  .toolbar button.cancel-btn:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.25);
    color: #ef4444;
  }
  .toolbar button.confirm-btn {
    background: #07c160;
    color: #ffffff;
    width: 32px;
    height: 28px;
    border-radius: 4px;
    box-shadow: 0 2px 6px rgba(7, 193, 96, 0.3);
  }
  .toolbar button.confirm-btn:hover:not(:disabled) {
    background: #06ad56;
  }
`;
