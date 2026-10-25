import NotesIcons from './icons.js';
import { pageElement } from './page-element.ts';

export const I = (name: string) => NotesIcons.svg(name);

export function setLabel(btn: HTMLButtonElement, text: string) {
  const l = btn.querySelector('.lbl');
  if (l) l.textContent = text; else btn.textContent = text;
}
export function setIcon(btn: HTMLButtonElement | HTMLElement | null, name: string) {
  if (!btn) return;
  if (btn.dataset.icon === name) return;
  btn.dataset.icon = name;
  NotesIcons.hydrate(btn.parentElement);
}
export function setPressed(btn: HTMLButtonElement, on: boolean) {
  btn.classList.toggle('is-on', !!on);
  btn.setAttribute('aria-pressed', String(!!on));
}

export const el = {
  app: pageElement('#app', HTMLDivElement),
  sidebar: pageElement('#sidebar', HTMLElement),
  newNoteBtn: pageElement('#newNoteBtn', HTMLButtonElement),
  navItems: Array.from(document.querySelectorAll('.nav-item[data-view]')).filter((b): b is HTMLElement => b instanceof HTMLElement),
  countAll: pageElement('#countAll', HTMLSpanElement), countPinned: pageElement('#countPinned', HTMLSpanElement), countTrash: pageElement('#countTrash', HTMLSpanElement), countReminders: pageElement('#countReminders', HTMLSpanElement),
  remindBtn: pageElement('#remindBtn', HTMLButtonElement), remindDialog: pageElement('#remindDialog', HTMLDialogElement), remindForm: pageElement('#remindForm', HTMLFormElement), remindInput: pageElement('#remindInput', HTMLInputElement), remindQuick: pageElement('#remindQuick', HTMLDivElement),
  remindCurrent: pageElement('#remindCurrent', HTMLParagraphElement), remindClearBtn: pageElement('#remindClearBtn', HTMLButtonElement), remindCancelBtn: pageElement('#remindCancelBtn', HTMLButtonElement),
  shareBtn: pageElement('#shareBtn', HTMLButtonElement), shareMenu: pageElement('#shareMenu', HTMLDivElement), shareReveal: pageElement('#shareReveal', HTMLButtonElement),
  lockBtn: pageElement('#lockBtn', HTMLButtonElement), lockMenu: pageElement('#lockMenu', HTMLDivElement), lockDialog: pageElement('#lockDialog', HTMLDialogElement), lockForm: pageElement('#lockForm', HTMLFormElement), lockDialogTitle: pageElement('#lockDialogTitle', HTMLHeadingElement), lockDialogHint: pageElement('#lockDialogHint', HTMLParagraphElement),
  lockPassword: pageElement('#lockPassword', HTMLInputElement), lockPassword2: pageElement('#lockPassword2', HTMLInputElement), lockConfirmRow: pageElement('#lockConfirmRow', HTMLLabelElement), lockError: pageElement('#lockError', HTMLParagraphElement), lockCancelBtn: pageElement('#lockCancelBtn', HTMLButtonElement), lockSubmitBtn: pageElement('#lockSubmitBtn', HTMLButtonElement),
  liveRow: pageElement('#liveRow', HTMLDivElement), liveText: pageElement('#liveText', HTMLSpanElement), liveLinkBtn: pageElement('#liveLinkBtn', HTMLButtonElement), liveStopBtn: pageElement('#liveStopBtn', HTMLButtonElement), shareLiveHost: pageElement('#shareLiveHost', HTMLButtonElement), shareLiveStop: pageElement('#shareLiveStop', HTMLButtonElement),
  liveDialog: pageElement('#liveDialog', HTMLDialogElement), liveForm: pageElement('#liveForm', HTMLFormElement), liveDialogTitle: pageElement('#liveDialogTitle', HTMLHeadingElement), liveDialogHint: pageElement('#liveDialogHint', HTMLParagraphElement), liveLinkLabel: pageElement('#liveLinkLabel', HTMLSpanElement), liveLinkInput: pageElement('#liveLinkInput', HTMLInputElement),
  liveError: pageElement('#liveError', HTMLParagraphElement), liveCopyBtn: pageElement('#liveCopyBtn', HTMLButtonElement), liveCancelBtn: pageElement('#liveCancelBtn', HTMLButtonElement), liveSubmitBtn: pageElement('#liveSubmitBtn', HTMLButtonElement),
  pageMenu: pageElement('#pageMenu', HTMLDivElement), bookMenu: pageElement('#bookMenu', HTMLDivElement), newBookBtn: pageElement('#newBookBtn', HTMLButtonElement),
  splitBtn: pageElement('#splitBtn', HTMLButtonElement), splitDialog: pageElement('#splitDialog', HTMLDialogElement), splitForm: pageElement('#splitForm', HTMLFormElement), splitLead: pageElement('#splitLead', HTMLParagraphElement), splitPages: pageElement('#splitPages', HTMLOListElement), splitName: pageElement('#splitName', HTMLInputElement), splitKeep: pageElement('#splitKeep', HTMLInputElement), splitCancelBtn: pageElement('#splitCancelBtn', HTMLButtonElement),
  bookReader: pageElement('#bookReader', HTMLElement), bookReaderTitle: pageElement('#bookReaderTitle', HTMLSpanElement), bookReaderToc: pageElement('#bookReaderToc', HTMLElement), bookReaderBody: pageElement('#bookReaderBody', HTMLDivElement), bookReaderScroll: pageElement('#bookReaderScroll', HTMLDivElement),
  bookReaderPdfBtn: pageElement('#bookReaderPdfBtn', HTMLButtonElement), bookReaderPrintBtn: pageElement('#bookReaderPrintBtn', HTMLButtonElement), bookReaderCloseBtn: pageElement('#bookReaderCloseBtn', HTMLButtonElement),
  bookStrip: pageElement('#bookStrip', HTMLElement), bookName: pageElement('#bookName', HTMLButtonElement), bookTabs: pageElement('#bookTabs', HTMLDivElement), bookPrevBtn: pageElement('#bookPrevBtn', HTMLButtonElement), bookNextBtn: pageElement('#bookNextBtn', HTMLButtonElement), bookAddBtn: pageElement('#bookAddBtn', HTMLButtonElement),
  relatedPanel: pageElement('#relatedPanel', HTMLElement), relatedOut: pageElement('#relatedOut', HTMLDivElement), relatedIn: pageElement('#relatedIn', HTMLDivElement), relatedTags: pageElement('#relatedTags', HTMLDivElement), folderMenuBook: pageElement('#folderMenuBook', HTMLButtonElement),
  lockScreen: pageElement('#lockScreen', HTMLFormElement), lockScreenPassword: pageElement('#lockScreenPassword', HTMLInputElement), lockScreenBtn: pageElement('#lockScreenBtn', HTMLButtonElement), lockScreenError: pageElement('#lockScreenError', HTMLParagraphElement),
  tagList: pageElement('#tagList', HTMLElement),
  themeBtn: pageElement('#themeBtn', HTMLButtonElement), settingsBtn: pageElement('#settingsBtn', HTMLButtonElement),
  hotkeyHint: pageElement('#hotkeyHint', HTMLSpanElement), hotkeyHint2: pageElement('#hotkeyHint2', HTMLSpanElement),
  searchInput: pageElement('#searchInput', HTMLInputElement), sortSelect: pageElement('#sortSelect', HTMLSelectElement),
  listTitle: pageElement('#listTitle', HTMLHeadingElement), emptyTrashBtn: pageElement('#emptyTrashBtn', HTMLButtonElement),
  noteList: pageElement('#noteList', HTMLUListElement), listEmpty: pageElement('#listEmpty', HTMLDivElement),
  editorEmpty: pageElement('#editorEmpty', HTMLDivElement), editor: pageElement('#editor', HTMLDivElement),
  editorPane: pageElement('#editorPane', HTMLElement), paneMain: pageElement('#paneMain', HTMLDivElement), tabBar: pageElement('#tabBar', HTMLDivElement), tabList: pageElement('#tabList', HTMLDivElement), tabAddBtn: pageElement('#tabAddBtn', HTMLButtonElement), splitViewBtn: pageElement('#splitViewBtn', HTMLButtonElement), paneCloseBtn: pageElement('#paneCloseBtn', HTMLButtonElement), splitDivider: pageElement('#splitDivider', HTMLDivElement),
  toggleSidebarBtn: pageElement('#toggleSidebarBtn', HTMLButtonElement), toggleListBtn: pageElement('#toggleListBtn', HTMLButtonElement), hideListBtn: pageElement('#hideListBtn', HTMLButtonElement), pinBtn: pageElement('#pinBtn', HTMLButtonElement), sourceBtn: pageElement('#sourceBtn', HTMLButtonElement),
  editorColumn: pageElement('#editorColumn', HTMLDivElement), richEditor: pageElement('#richEditor', HTMLDivElement),
  linkDialog: pageElement('#linkDialog', HTMLDialogElement), linkForm: pageElement('#linkForm', HTMLFormElement), linkInput: pageElement('#linkInput', HTMLInputElement), linkRemoveBtn: pageElement('#linkRemoveBtn', HTMLButtonElement), linkCancelBtn: pageElement('#linkCancelBtn', HTMLButtonElement),
  alignSeg: pageElement('#alignSeg', HTMLDivElement), editorWidthInput: pageElement('#editorWidthInput', HTMLInputElement), editorWidthValue: pageElement('#editorWidthValue', HTMLSpanElement), editorFullWidthInput: pageElement('#editorFullWidthInput', HTMLInputElement),
  gitEnabledInput: pageElement('#gitEnabledInput', HTMLInputElement), gitRemoteInput: pageElement('#gitRemoteInput', HTMLInputElement), gitStatus: pageElement('#gitStatus', HTMLSpanElement), gitCommitBtn: pageElement('#gitCommitBtn', HTMLButtonElement), gitPushBtn: pageElement('#gitPushBtn', HTMLButtonElement),
  exportBtn: pageElement('#exportBtn', HTMLButtonElement), duplicateBtn: pageElement('#duplicateBtn', HTMLButtonElement), restoreBtn: pageElement('#restoreBtn', HTMLButtonElement),
  deleteBtn: pageElement('#deleteBtn', HTMLButtonElement), destroyBtn: pageElement('#destroyBtn', HTMLButtonElement),
  titleInput: pageElement('#titleInput', HTMLInputElement), tagsInput: pageElement('#tagsInput', HTMLInputElement), bodyInput: pageElement('#bodyInput', HTMLTextAreaElement), codeHost: pageElement('#codeHost', HTMLDivElement), csvView: pageElement('#csvView', HTMLDivElement), imageViewer: pageElement('#imageViewer', HTMLElement), imageView: pageElement('#imageView', HTMLImageElement),
  statusWords: pageElement('#statusWords', HTMLSpanElement), statusChars: pageElement('#statusChars', HTMLSpanElement), statusUpdated: pageElement('#statusUpdated', HTMLSpanElement), statusSaved: pageElement('#statusSaved', HTMLSpanElement), statusCode: pageElement('#statusCode', HTMLSpanElement),
  settingsDialog: pageElement('#settingsDialog', HTMLDialogElement), settingsForm: pageElement('#settingsForm', HTMLFormElement),
  hotkeyInput: pageElement('#hotkeyInput', HTMLInputElement), hotkeyError: pageElement('#hotkeyError', HTMLSpanElement), themeSelect: pageElement('#themeSelect', HTMLSelectElement),
  schemeGrid: pageElement('#schemeGrid', HTMLDivElement), customModeNote: pageElement('#customModeNote', HTMLSpanElement), customBgInput: pageElement('#customBgInput', HTMLInputElement), customTextInput: pageElement('#customTextInput', HTMLInputElement), customAccentInput: pageElement('#customAccentInput', HTMLInputElement), schemeResetBtn: pageElement('#schemeResetBtn', HTMLButtonElement),
  settingsDirtyNote: pageElement('#settingsDirtyNote', HTMLSpanElement), cancelSettingsBtn: pageElement('#cancelSettingsBtn', HTMLButtonElement), saveSettingsBtn: pageElement('#saveSettingsBtn', HTMLButtonElement),
  settingsSaveDialog: pageElement('#settingsSaveDialog', HTMLDialogElement), settingsSaveKeepBtn: pageElement('#settingsSaveKeepBtn', HTMLButtonElement), settingsSaveDiscardBtn: pageElement('#settingsSaveDiscardBtn', HTMLButtonElement), settingsSaveList: pageElement('#settingsSaveList', HTMLParagraphElement),
  fontSizeInput: pageElement('#fontSizeInput', HTMLInputElement), fontSizeValue: pageElement('#fontSizeValue', HTMLSpanElement),
  openAtLoginInput: pageElement('#openAtLoginInput', HTMLInputElement), alwaysOnTopInput: pageElement('#alwaysOnTopInput', HTMLInputElement),
  importBtn: pageElement('#importBtn', HTMLButtonElement), exportAllBtn: pageElement('#exportAllBtn', HTMLButtonElement), dataFolderBtn: pageElement('#dataFolderBtn', HTMLButtonElement),
  settingsInfo: pageElement('#settingsInfo', HTMLParagraphElement),
  toast: pageElement('#toast', HTMLDivElement),
  sidebarResizer: pageElement('#sidebarResizer', HTMLDivElement), listResizer: pageElement('#listResizer', HTMLDivElement),
  newFolderBtn: pageElement('#newFolderBtn', HTMLButtonElement), folderTree: pageElement('#folderTree', HTMLElement), folderSelect: pageElement('#folderSelect', HTMLSelectElement), folderMenu: pageElement('#folderMenu', HTMLDivElement),
  navAll: pageElement('.nav-item[data-view="all"]', HTMLButtonElement),
  openFileBtn: pageElement('#openFileBtn', HTMLButtonElement), fileRow: pageElement('#fileRow', HTMLDivElement), fileKind: pageElement('#fileKind', HTMLSpanElement), filePath: pageElement('#filePath', HTMLSpanElement),
  fileRevealBtn: pageElement('#fileRevealBtn', HTMLButtonElement), fileOpenBtn: pageElement('#fileOpenBtn', HTMLButtonElement), fileReloadBtn: pageElement('#fileReloadBtn', HTMLButtonElement), docxView: pageElement('#docxView', HTMLIFrameElement), docxEditor: pageElement('#docxEditor', HTMLDivElement), docxSaveBtn: pageElement('#docxSaveBtn', HTMLButtonElement),
  fileConvertBtn: pageElement('#fileConvertBtn', HTMLButtonElement), convertMenu: pageElement('#convertMenu', HTMLDivElement),
  fileBanner: pageElement('#fileBanner', HTMLDivElement), pdfEditor: pageElement('#pdfEditor', HTMLDivElement), pdfSaveBtn: pageElement('#pdfSaveBtn', HTMLButtonElement), pdfUndoBtn: pageElement('#pdfUndoBtn', HTMLButtonElement), pdfRedoBtn: pageElement('#pdfRedoBtn', HTMLButtonElement), pdfZoomLabel: pageElement('#pdfZoom', HTMLButtonElement), pdfPages: pageElement('#pdfPages', HTMLDivElement), pdfComments: pageElement('#pdfComments', HTMLElement), pdfCommentsBtn: pageElement('#pdfCommentsBtn', HTMLButtonElement), pdfCommentsClose: pageElement('#pdfCommentsClose', HTMLButtonElement), agentFilesBtn: pageElement('#agentFilesBtn', HTMLButtonElement), agentFilesStatus: pageElement('#agentFilesStatus', HTMLSpanElement),
  signDialog: pageElement('#signDialog', HTMLDialogElement), signForm: pageElement('#signForm', HTMLFormElement), signPad: pageElement('#signPad', HTMLCanvasElement), signRemember: pageElement('#signRemember', HTMLInputElement), signClearBtn: pageElement('#signClearBtn', HTMLButtonElement),
  signForgetBtn: pageElement('#signForgetBtn', HTMLButtonElement), signCancelBtn: pageElement('#signCancelBtn', HTMLButtonElement), signPlaceBtn: pageElement('#signPlaceBtn', HTMLButtonElement), signName: pageElement('#signName', HTMLInputElement), signTypeBtn: pageElement('#signTypeBtn', HTMLButtonElement), signStatus: pageElement('#signStatus', HTMLParagraphElement),
  readAloudBtn: pageElement('#readAloudBtn', HTMLButtonElement), dictateBtn: pageElement('#dictateBtn', HTMLButtonElement), ttsVoiceSelect: pageElement('#ttsVoiceSelect', HTMLSelectElement), ttsRateInput: pageElement('#ttsRateInput', HTMLInputElement), ttsRateValue: pageElement('#ttsRateValue', HTMLSpanElement),
  vaultList: pageElement('#vaultList', HTMLDivElement), vaultAddFolderBtn: pageElement('#vaultAddFolderBtn', HTMLButtonElement), vaultCloneBtn: pageElement('#vaultCloneBtn', HTMLButtonElement),
  vaultDialog: pageElement('#vaultDialog', HTMLDialogElement), vaultForm: pageElement('#vaultForm', HTMLFormElement), vaultUrlInput: pageElement('#vaultUrlInput', HTMLInputElement), vaultDestInput: pageElement('#vaultDestInput', HTMLInputElement), vaultDestBtn: pageElement('#vaultDestBtn', HTMLButtonElement),
  vaultNameInput: pageElement('#vaultNameInput', HTMLInputElement), vaultError: pageElement('#vaultError', HTMLSpanElement), vaultCancelBtn: pageElement('#vaultCancelBtn', HTMLButtonElement), vaultCloneSubmitBtn: pageElement('#vaultCloneSubmitBtn', HTMLButtonElement),
  folderMenuSync: pageElement('#folderMenuSync', HTMLButtonElement), folderMenuOpen: pageElement('#folderMenuOpen', HTMLButtonElement),
  stickyBtn: pageElement('#stickyBtn', HTMLButtonElement), botBtn: pageElement('#botBtn', HTMLButtonElement), printBtn: pageElement('#printBtn', HTMLButtonElement),
  findBar: pageElement('#findBar', HTMLDivElement), findInput: pageElement('#findInput', HTMLInputElement), findCount: pageElement('#findCount', HTMLSpanElement), findPrevBtn: pageElement('#findPrevBtn', HTMLButtonElement), findNextBtn: pageElement('#findNextBtn', HTMLButtonElement), findCloseBtn: pageElement('#findCloseBtn', HTMLButtonElement),
  findReplaceToggle: pageElement('#findReplaceToggle', HTMLButtonElement), replaceRow: pageElement('#replaceRow', HTMLDivElement), replaceInput: pageElement('#replaceInput', HTMLInputElement), replaceOneBtn: pageElement('#replaceOneBtn', HTMLButtonElement), replaceAllBtn: pageElement('#replaceAllBtn', HTMLButtonElement),
  attachBtn: pageElement('#attachBtn', HTMLButtonElement), recordBtn: pageElement('#recordBtn', HTMLButtonElement), historyBtn: pageElement('#historyBtn', HTMLButtonElement), historyKeepBtn: pageElement('#historyKeepBtn', HTMLButtonElement), linkNoteSelect: pageElement('#linkNoteSelect', HTMLSelectElement),
  historyDialog: pageElement('#historyDialog', HTMLDialogElement), historyList: pageElement('#historyList', HTMLUListElement), historyPreview: pageElement('#historyPreview', HTMLPreElement), historyStatus: pageElement('#historyStatus', HTMLSpanElement), historyHint: pageElement('#historyHint', HTMLParagraphElement), historyRecordBtn: pageElement('#historyRecordBtn', HTMLButtonElement), historyCloseBtn: pageElement('#historyCloseBtn', HTMLButtonElement), historyRestoreBtn: pageElement('#historyRestoreBtn', HTMLButtonElement), botPanel: pageElement('#botPanel', HTMLElement), botScope: pageElement('#botScope', HTMLSpanElement), botAllowEdits: pageElement('#botAllowEdits', HTMLInputElement), botTerminalBtn: pageElement('#botTerminalBtn', HTMLButtonElement),
  botCloseBtn: pageElement('#botCloseBtn', HTMLButtonElement), botPrompt: pageElement('#botPrompt', HTMLTextAreaElement), botRunBtn: pageElement('#botRunBtn', HTMLButtonElement), botOutput: pageElement('#botOutput', HTMLPreElement),
  moreBtn: pageElement('#moreBtn', HTMLButtonElement), moreMenu: pageElement('#moreMenu', HTMLDivElement), paletteBtn: pageElement('#paletteBtn', HTMLButtonElement), palette: pageElement('#palette', HTMLDialogElement), paletteInput: pageElement('#paletteInput', HTMLInputElement), paletteList: pageElement('#paletteList', HTMLUListElement),
  inlineMenu: pageElement('#inlineMenu', HTMLDivElement), wordcraftFrame: pageElement('#wordcraftFrame', HTMLIFrameElement), gridcraftFrame: pageElement('#gridcraftFrame', HTMLIFrameElement),
  sidebarTop: pageElement('#sidebarTop', HTMLDivElement), barToggles: pageElement('#barToggles', HTMLDivElement), sidebarEdge: pageElement('#sidebarEdge', HTMLDivElement), noteTree: pageElement('#noteTree', HTMLDivElement), noteActions: pageElement('#noteActions', HTMLDivElement),
  tagsFold: pageElement('#tagsFold', HTMLButtonElement), listModeSeg: pageElement('#listModeSeg', HTMLDivElement), sidebarFloatInput: pageElement('#sidebarFloatInput', HTMLInputElement),
  activityBar: pageElement('#activityBar', HTMLDivElement), emptyNewNoteBtn: pageElement('#emptyNewNoteBtn', HTMLButtonElement), settingsNav: pageElement('#settingsNav', HTMLElement), settingsScroll: pageElement('#settingsScroll', HTMLDivElement),
  settingsSearch: pageElement('#settingsSearch', HTMLInputElement), settingsEmpty: pageElement('#settingsEmpty', HTMLDivElement),
};
